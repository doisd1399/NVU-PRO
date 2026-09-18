#!/usr/bin/env node

import fs from "node:fs/promises";
import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

function readArg(name, fallback = "") {
  const prefix = `${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function fail(message) {
  console.error(`ERRO: ${message}`);
  process.exitCode = 1;
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function toMillis(value) {
  if (!hasValue(value)) return null;
  if (typeof value?.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
    const seconds = Number(value.seconds);
    const nanos = Number(value.nanoseconds || 0);
    const millis = seconds * 1000 + Math.floor(nanos / 1_000_000);
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "number") {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value;
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return null;
    const millis = Date.parse(trimmed);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function isoFromValue(value) {
  const millis = toMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

function postKind(data) {
  return String(data.tipo || data.type || data.categoria || "").trim().toLowerCase();
}

function classify(data, source) {
  if (hasValue(data.publishedAt)) return { status: "SKIP_ALREADY_HAS_PUBLISHED_AT" };
  if (postKind(data) === "classificacao") {
    return { status: "REVIEW_CLASSIFICATION_REQUIRES_PUBLISH_LOG", kind: postKind(data) };
  }
  if (!hasValue(data.createdAt)) return { status: "REVIEW_NO_CREATED_AT" };

  const millis = toMillis(data.createdAt);
  if (millis === null) return { status: "REVIEW_CREATED_AT_NOT_EXPLICIT_INSTANT" };
  if (source !== "createdAt") {
    return {
      status: "CANDIDATE_CREATED_AT",
      sourceField: "createdAt",
      publishedAtIso: new Date(millis).toISOString(),
      kind: postKind(data),
    };
  }

  return {
    status: "ELIGIBLE_CREATED_AT",
    sourceField: "createdAt",
    publishedAtIso: new Date(millis).toISOString(),
    kind: postKind(data),
  };
}

async function main() {
  const execute = hasFlag("--execute");
  const collection = readArg("--collection", process.env.NVU_NEWS_COLLECTION || "");
  const allowedCollections = new Set(["nvu_classificacoes", "nvu_comunicados"]);
  const requestedLimit = Number(readArg("--limit", "100"));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100;
  const source = readArg("--source", "none");
  const acknowledged = hasFlag("--ack-createdAt-is-publication");
  const approvedIdsPath = readArg("--approved-ids", "");
  const startAfterId = readArg("--start-after", "");
  const reportPath = readArg(
    "--report",
    `nvu-news-publishedAt-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || undefined;

  if (!allowedCollections.has(collection)) {
    return fail("Informe --collection=nvu_classificacoes ou --collection=nvu_comunicados.");
  }
  if (execute && (source !== "createdAt" || !acknowledged || !approvedIdsPath)) {
    return fail(
      "A escrita exige --source=createdAt, --ack-createdAt-is-publication e --approved-ids. Sem isso, o script permanece em dry-run.",
    );
  }

  const approvedIds = new Set(
    approvedIdsPath
      ? (await fs.readFile(approvedIdsPath, "utf8"))
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
      : [],
  );

  const app = getApps()[0] || initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
  const db = getFirestore(app);
  const collectionRef = db.collection(collection);
  let collectionQuery = collectionRef.orderBy(FieldPath.documentId());
  if (startAfterId) collectionQuery = collectionQuery.startAfter(startAfterId);
  const snapshot = await collectionQuery.limit(limit).get();

  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    projectId: projectId || "application-default",
    collection,
    dryRun: !execute,
    source,
    limit,
    startAfterId: startAfterId || null,
    writesAttempted: 0,
    writesApplied: 0,
    counts: {},
    decisions: [],
  };

  for (const document of snapshot.docs) {
    const initialData = document.data();
    const initialDecision = classify(initialData, source);
    let finalDecision = initialDecision;

    if (execute && !approvedIds.has(document.id)) {
      finalDecision = { status: "SKIP_NOT_APPROVED_ID" };
    }

    if (execute && finalDecision.status === "ELIGIBLE_CREATED_AT") {
      report.writesAttempted += 1;
      finalDecision = await db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(document.ref);
        const freshData = fresh.data() || {};
        const freshDecision = classify(freshData, source);
        if (freshDecision.status !== "ELIGIBLE_CREATED_AT") {
          return { ...freshDecision, status: "SKIP_CHANGED_BEFORE_WRITE" };
        }

        transaction.update(document.ref, {
          publishedAt: Timestamp.fromMillis(Date.parse(freshDecision.publishedAtIso)),
          publishedAtSource: "createdAt_legacy",
          publishedAtBackfillVersion: "v1",
          publishedAtBackfilledAt: FieldValue.serverTimestamp(),
        });
        return freshDecision;
      });
      if (finalDecision.status === "ELIGIBLE_CREATED_AT") report.writesApplied += 1;
    }

    report.counts[finalDecision.status] = (report.counts[finalDecision.status] || 0) + 1;
    report.decisions.push({
      id: document.id,
      status: finalDecision.status,
      sourceField: finalDecision.sourceField || null,
      publishedAtIso: finalDecision.publishedAtIso || null,
      kind: finalDecision.kind || postKind(initialData) || null,
      publishedAtExistingIso: isoFromValue(initialData.publishedAt),
      updatedAtIso: isoFromValue(initialData.updatedAt),
      createdAtIso: isoFromValue(initialData.createdAt),
      approvedAtIso: isoFromValue(initialData.approvedAt),
      sortAtIso: isoFromValue(initialData.sortAt),
      dataReferenciaIso: isoFromValue(initialData.dataReferencia),
    });
  }

  report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    dryRun: report.dryRun,
    collection: report.collection,
    scanned: report.decisions.length,
    writesAttempted: report.writesAttempted,
    writesApplied: report.writesApplied,
    counts: report.counts,
    reportPath,
    startAfterId: startAfterId || null,
    lastDocumentId: snapshot.docs.at(-1)?.id || null,
    hasMore: snapshot.size === limit,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

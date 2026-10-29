import * as functions from "firebase-functions/v1";
import * as admin from "./firebaseAdmin";
import { createHash } from "node:crypto";

const db = admin.firestore();

const CANDIDATES_COLLECTION = "storage_cleanup_candidates";
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const USER_IMAGE_FIELDS = new Set([
  "profilePhotoURL",
  "profilePhotoUrl",
  "photoURL",
  "photoUrl",
  "avatarURL",
  "avatarUrl",
  "avatar",
  "profileImage",
  "imageURL",
  "imageUrl",
  "foto",
  "fotoURL",
  "fotoUrl",
  "profilePhotoStoragePath",
  "photoStoragePath",
  "avatarStoragePath",
]);

const COMPANY_IMAGE_FIELDS = new Set([
  "logoUrl",
  "logoURL",
  "logo",
  "companyLogoURL",
  "companyLogoUrl",
  "companyLogo",
  "logoEmpresa",
  "logo_empresa",
  "imageURL",
  "imageUrl",
  "avatar",
  "logoStoragePath",
  "companyLogoStoragePath",
  "ownerPhotoUrl",
  "ownerPhotoURL",
  "ownerPhoto",
  "ownerPhotoStoragePath",
]);

type MonitoredCollection = "users" | "frotas";
type CandidateReason = "image_replaced_or_removed" | "source_document_deleted";

type StorageReference = {
  key: string;
  bucket: string;
  storagePath: string;
  fields: string[];
  values: string[];
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function resolveDefaultBucketName(): string | null {
  try {
    return asNonEmptyString(admin.storage().bucket().name);
  } catch (error) {
    console.warn("[STORAGE CLEANUP DRY-RUN] Bucket padrão não disponível.", error);
    return null;
  }
}

const DEFAULT_BUCKET_NAME = resolveDefaultBucketName();

function expectedBucketNames(): Set<string> {
  const names = new Set<string>();
  if (DEFAULT_BUCKET_NAME) names.add(DEFAULT_BUCKET_NAME);

  const projectId =
    asNonEmptyString(process.env.GCLOUD_PROJECT) ||
    asNonEmptyString(admin.app().options.projectId);

  if (projectId) {
    names.add(`${projectId}.appspot.com`);
    names.add(`${projectId}.firebasestorage.app`);
  }

  return names;
}

const ALLOWED_BUCKETS = expectedBucketNames();

function normalizeStoragePath(value: string): string | null {
  let path = value.trim();
  if (!path) return null;

  path = path.replace(/^\/+/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Mantém o valor original quando houver escapes legados inválidos.
  }

  path = path.replace(/^\/+/, "");
  if (!path || path.endsWith("/") || path.includes("\0")) return null;

  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  return path;
}

function isAllowedBucket(bucket: string): boolean {
  if (!bucket) return false;
  if (ALLOWED_BUCKETS.size === 0) return false;
  return ALLOWED_BUCKETS.has(bucket);
}

function parseStorageSource(
  value: string,
  allowRawStoragePath: boolean,
): { bucket: string; storagePath: string } | null {
  if (/^(data|blob):/i.test(value)) return null;

  if (value.startsWith("gs://")) {
    const withoutScheme = value.slice(5);
    const separator = withoutScheme.indexOf("/");
    if (separator <= 0) return null;
    const bucket = withoutScheme.slice(0, separator);
    const storagePath = normalizeStoragePath(withoutScheme.slice(separator + 1));
    return storagePath && isAllowedBucket(bucket) ? { bucket, storagePath } : null;
  }

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }

    if (url.hostname === "firebasestorage.googleapis.com") {
      const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (!match) return null;
      const bucket = decodeURIComponent(match[1]);
      const storagePath = normalizeStoragePath(match[2]);
      return storagePath && isAllowedBucket(bucket) ? { bucket, storagePath } : null;
    }

    if (url.hostname === "storage.googleapis.com") {
      const match = url.pathname.match(/^\/([^/]+)\/(.+)$/);
      if (!match) return null;
      const bucket = decodeURIComponent(match[1]);
      const storagePath = normalizeStoragePath(match[2]);
      return storagePath && isAllowedBucket(bucket) ? { bucket, storagePath } : null;
    }

    // URLs externas e imagens padrão nunca entram na fila de limpeza.
    return null;
  }

  if (!allowRawStoragePath) return null;
  const storagePath = normalizeStoragePath(value);
  const bucket = DEFAULT_BUCKET_NAME || Array.from(ALLOWED_BUCKETS)[0] || "";
  return storagePath && bucket ? { bucket, storagePath } : null;
}

function sanitizeRecordedValue(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split("?")[0];
  }
}

function imageFieldsFor(collectionName: MonitoredCollection): Set<string> {
  return collectionName === "users" ? USER_IMAGE_FIELDS : COMPANY_IMAGE_FIELDS;
}

function collectStorageReferences(
  collectionName: MonitoredCollection,
  data: Record<string, unknown> | undefined,
): Map<string, StorageReference> {
  const references = new Map<string, StorageReference>();
  if (!data) return references;

  const monitoredFields = imageFieldsFor(collectionName);
  for (const field of monitoredFields) {
    const value = asNonEmptyString(data[field]);
    if (!value) continue;

    const parsed = parseStorageSource(value, /StoragePath$/i.test(field));
    if (!parsed) continue;

    const key = `${parsed.bucket}/${parsed.storagePath}`;
    const current = references.get(key);
    if (current) {
      if (!current.fields.includes(field)) current.fields.push(field);
      const recordedValue = sanitizeRecordedValue(value);
      if (!current.values.includes(recordedValue) && current.values.length < 5) {
        current.values.push(recordedValue);
      }
      continue;
    }

    references.set(key, {
      key,
      bucket: parsed.bucket,
      storagePath: parsed.storagePath,
      fields: [field],
      values: [sanitizeRecordedValue(value)],
    });
  }

  return references;
}

function candidateId(reference: StorageReference): string {
  return createHash("sha256").update(reference.key).digest("hex");
}

function sourceReference(collectionName: MonitoredCollection, documentId: string) {
  return {
    collection: collectionName,
    documentId,
    documentPath: `${collectionName}/${documentId}`,
  };
}

async function registerCandidate(
  collectionName: MonitoredCollection,
  documentId: string,
  reference: StorageReference,
  reason: CandidateReason,
) {
  const now = admin.firestore.Timestamp.now();
  const deleteAfter = admin.firestore.Timestamp.fromMillis(now.toMillis() + RETENTION_MS);
  const ref = db.collection(CANDIDATES_COLLECTION).doc(candidateId(reference));
  const source = sourceReference(collectionName, documentId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() || {} : {};
    const detectedAt = existing.detectedAt || now;
    const existingDeleteAfter = existing.deleteAfter;

    transaction.set(
      ref,
      {
        bucket: reference.bucket,
        storagePath: reference.storagePath,
        previousValues: admin.firestore.FieldValue.arrayUnion(...reference.values),
        sourceFields: admin.firestore.FieldValue.arrayUnion(...reference.fields),
        sourceReferences: admin.firestore.FieldValue.arrayUnion(source),
        sourceCollection: collectionName,
        sourceDocumentId: documentId,
        reason,
        status: "pending_review",
        mode: "dry_run",
        dryRun: true,
        deletionEnabled: false,
        stillReferenced: null,
        referenceCheckStatus: "not_run",
        retentionDays: RETENTION_DAYS,
        detectedAt,
        lastDetectedAt: now,
        deleteAfter: existingDeleteAfter || deleteAfter,
        updatedAt: now,
        cancelledAt: admin.firestore.FieldValue.delete(),
        lastReferencedAt: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );
  });
}

async function cancelCandidateIfReferencedAgain(reference: StorageReference) {
  const ref = db.collection(CANDIDATES_COLLECTION).doc(candidateId(reference));
  const snapshot = await ref.get();
  if (!snapshot.exists) return;

  await ref.set(
    {
      status: "cancelled_referenced_again",
      stillReferenced: true,
      referenceCheckStatus: "same_document_reference_detected",
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      lastReferencedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletionEnabled: false,
      dryRun: true,
    },
    { merge: true },
  );
}

async function auditImageChange(
  collectionName: MonitoredCollection,
  documentId: string,
  beforeData: Record<string, unknown> | undefined,
  afterData: Record<string, unknown> | undefined,
  reason: CandidateReason,
) {
  const before = collectStorageReferences(collectionName, beforeData);
  const after = collectStorageReferences(collectionName, afterData);

  const removed = Array.from(before.values()).filter((reference) => !after.has(reference.key));
  const added = Array.from(after.values()).filter((reference) => !before.has(reference.key));

  if (removed.length === 0 && added.length === 0) return;

  // As operações são independentes: uma falha pontual não impede o registro
  // dos demais candidatos encontrados no mesmo documento.
  const results = await Promise.allSettled([
    ...removed.map((reference) =>
      registerCandidate(collectionName, documentId, reference, reason),
    ),
    ...added.map((reference) => cancelCandidateIfReferencedAgain(reference)),
  ]);

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[STORAGE CLEANUP DRY-RUN] Falha ao registrar alteração.", {
        collectionName,
        documentId,
        operationIndex: index,
        error: result.reason,
      });
    }
  });
}

export const auditUserStorageImagesOnUpdate = functions.firestore
  .document("users/{documentId}")
  .onUpdate(async (change, context) => {
    await auditImageChange(
      "users",
      context.params.documentId,
      change.before.data() as Record<string, unknown>,
      change.after.data() as Record<string, unknown>,
      "image_replaced_or_removed",
    );
  });

export const auditCompanyStorageImagesOnUpdate = functions.firestore
  .document("frotas/{documentId}")
  .onUpdate(async (change, context) => {
    await auditImageChange(
      "frotas",
      context.params.documentId,
      change.before.data() as Record<string, unknown>,
      change.after.data() as Record<string, unknown>,
      "image_replaced_or_removed",
    );
  });

export const auditUserStorageImagesOnDelete = functions.firestore
  .document("users/{documentId}")
  .onDelete(async (snapshot, context) => {
    await auditImageChange(
      "users",
      context.params.documentId,
      snapshot.data() as Record<string, unknown>,
      undefined,
      "source_document_deleted",
    );
  });

export const auditCompanyStorageImagesOnDelete = functions.firestore
  .document("frotas/{documentId}")
  .onDelete(async (snapshot, context) => {
    await auditImageChange(
      "frotas",
      context.params.documentId,
      snapshot.data() as Record<string, unknown>,
      undefined,
      "source_document_deleted",
    );
  });

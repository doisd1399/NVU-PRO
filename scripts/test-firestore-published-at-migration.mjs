import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/firestore-backfill-published-at.mjs");
const source = fs.readFileSync(scriptPath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("const execute = hasFlag(\"--execute\")"), "execute flag must be explicit");
assert(source.includes("nvu_classificacoes") && source.includes("nvu_comunicados"), "only real News collections may be accepted");
assert(source.includes("--approved-ids"), "write mode must require an approved ID list");
assert(source.includes("--ack-createdAt-is-publication"), "write mode must require an explicit operator acknowledgement");
assert(source.includes("SKIP_NOT_APPROVED_ID"), "unapproved documents must be skipped");
assert(source.includes("REVIEW_CLASSIFICATION_REQUIRES_PUBLISH_LOG"), "classification posts must require independent publication evidence");
assert(source.includes("publishedAtSource: \"createdAt_legacy\""), "backfill provenance must be recorded");
assert(source.includes("publishedAtBackfillVersion: \"v1\""), "backfill version must be recorded");
assert(source.includes("transaction.update(document.ref"), "writes must be conditional transactions");
assert(source.includes("if (hasValue(data.publishedAt)"), "existing publishedAt must never be overwritten");
assert(source.includes("if (/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return null"), "date-only strings must not become instants automatically");
assert(source.includes("if (!/(Z|[+-]"), "legacy strings must require an explicit timezone");
assert(!source.includes("data.sortAt"), "sortAt must not be used as publication source");
assert(!source.includes("data.dataReferencia"), "dataReferencia must not be used as publication source");

console.log("Firestore publishedAt migration safety contract passed");

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const gradle = read("android/app/build.gradle");
const origin = read("android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java");
const evidence = read("android/app/src/main/java/com/nvu/operacional/GtoFreightFieldEvidencePolicy.java");
const checks = [];
function check(name, ok, detail="") { checks.push({name,ok:!!ok}); console.log(`${ok?"PASS":"FAIL"} ${name}${detail?` — ${detail}`:""}`); }
function method(source,start,end){ const a=source.indexOf(start); if(a<0)return""; const b=source.indexOf(end,a+start.length); return source.slice(a,b<0?source.length:b); }

const hf18Code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const hf18Patch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0);
check("HF18+ identity remains at or above 1.0.70 / 70", hf18Code >= 70 && hf18Patch >= 70);
check("origin extraction supports wrapped selected-row OCR lines", origin.includes("inferFromRowLines") && service.includes("inferOriginCompanyFromSelectedRowLines"));
check("origin evidence no longer manufactures two OCR votes", !service.includes("selected.originCompanyVotes = Math.max(selected.originCompanyVotes, 2)"));
const reliability = method(service,"private boolean isFreightDataReliable","private boolean hasPartialResultSemanticEvidence");
check("freight reliability is field-level without global consensus", reliability.includes("GtoFreightFieldEvidencePolicy") && !reliability.includes("consensusFrames") && !reliability.includes("dataConfidence") && !reliability.includes("destinationCompany"));
const trusted = method(service,"private FreightOption trustedReviewDraft","private void clearReviewField");
check("review draft cannot promote a field using frameConsensus", !trusted.includes("frameConsensus") && trusted.includes("GtoFreightFieldEvidencePolicy"));
const reviewed = method(service,"private void commitReviewedFreight","private void transitionConfirmedFreightToTripInProgress");
check("manual review does not fabricate consensus or votes", !reviewed.includes("consensusFrames = 2") && !reviewed.includes("Votes =") && !reviewed.includes("originCompanyVotes ="));
check("both confirmation paths share one trip-start transition", (service.match(/transitionConfirmedFreightToTripInProgress\(\);/g)||[]).length >= 2 && service.includes("Tudo preparado, podemos partir!"));
const watchdog = method(service,"private void armFreightConfirmationWatchdog","private boolean canonicalSyncCallbackIsCurrent");
check("confirmed touch identity survives OCR watchdog timeout", watchdog.includes("hasConfirmedSelectionIdentity()") && watchdog.includes("enterFreightReview") && watchdog.includes("Nenhum frete foi confirmado"));
const clear = method(service, service.includes("private boolean clearTripAnalysis") ? "private boolean clearTripAnalysis" : "private void clearTripAnalysis", "private void openOperationalPanel");
check("trip reset clears review and selection identity residue", clear.includes('remove("pendingFreightReview")') && clear.includes('remove("reviewOriginCompany")') && clear.includes('remove("selectionIdentityStatus")'));
check("destination representation is reconciled before conflict", service.includes("GtoAcceptedFreightFieldPolicy.sameVisibleDestination(") && method(service,"private boolean hasCriticalFreightConflict","private boolean hasIndependentVisibleAgreement").includes("destinationCompany"));
check("empty manual field cannot submit", service.includes("save.setEnabled(false)") && service.includes("addTextChangedListener(new TextWatcher()"));
check("operational confidence excludes destinationCompany", service.includes("base.dataConfidence = evidence / 5f") && evidence.includes("return ok / 5f"));
const preciseTouch = method(service,"private void handlePreciseTouch","private int exactUniqueRowForTouch");
check("exact touch stays a candidate until a compatible screen transition", preciseTouch.includes("TOUCH_LOCKED") && preciseTouch.includes("armPreciseTouchAcceptanceProbe") && !preciseTouch.includes("runPreciseSelectedRowOcr(hit)") && !preciseTouch.includes("setTripState(STATE_CONFIRMING_FREIGHT"));
check("list exit can confirm only the exact touched row", service.includes("confirmPreciseTouchCandidateOnListExit") && service.includes("resolveExactTouchAfterTransition"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf18-"));
try {
  const run = spawnSync("java", [
    "scripts/java-tests/JavaTestRunner.java", tmp,
    "com.nvu.operacional.GtoR334Hf18FreightEvidencePolicyTest",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoFreightFieldEvidencePolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java",
    "android/app/src/main/java/com/nvu/operacional/GtoSelectionIdentityPolicy.java",
    "scripts/java-tests/com/nvu/operacional/GtoR334Hf18FreightEvidencePolicyTest.java"
  ], { encoding:"utf8" });
  const out=`${run.stdout||""}${run.stderr||""}`.trim();
  check("HF18 behavioral evidence tests compile", !out.includes("Java compilation failed"), out);
  check("HF18 multi-line origin and field evidence scenarios pass", run.status===0 && out.includes("PASS HF18 freight evidence policy"), out);
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} HF18 checks passed.`);
if(failed.length) process.exit(1);

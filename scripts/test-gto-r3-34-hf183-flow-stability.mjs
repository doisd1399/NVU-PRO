import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const overlay = read("android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java");
const bubbleTest = read("scripts/java-tests/com/nvu/operacional/GtoHf56BubblePositionPolicyTest.java");
const hf43 = read("scripts/test-gto-r3-34-hf43-responsive-messages.mjs");
const hf174 = read("scripts/test-gto-r3-34-hf174-route-card.mjs");
const checks = [];
const check = (name, ok) => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

check("SENDING wording is exactly the registering state", service.includes('"Registrando viagem..."'));
check("SENDING stage is rendered with an indeterminate spinner", service.includes('stageKey.endsWith("|TRIP_SENDING")') && service.includes("progressView.setIndeterminate(true)"));
check("success wording remains tied to SYNCED/ACK callbacks", service.includes('"Viagem registrada com sucesso!"') && hf43.includes("success wording is exposed only after a real SYNCED state/ACK"));

const restoreStart = service.indexOf("private void restoreBubbleAfterPermission");
const restoreEnd = service.indexOf("private void cancelTrip", restoreStart);
const restore = restoreStart >= 0 && restoreEnd > restoreStart ? service.slice(restoreStart, restoreEnd) : "";
check("permission-return restore uses the bridge policy, not a raw timestamp", restore.includes("hasVerifiedGtoProjectionBridge()") && !restore.includes("confirmedGto = GTO_PACKAGE.equals(foregroundPackage) || visualGtoFresh || verifiedBridge"));
check("known external foreground cannot be promoted by restore", restore.includes("if (!confirmedGto || transientForegroundSurfaceActive) return;") && restore.includes("GTO_PACKAGE.equals(foregroundPackage) || verifiedBridge"));
check("return resumes the preserved state only through confirmed GTO context", restore.includes("if (screenAnalysisPausedOutsideGto && confirmedGto)") && restore.includes("resumeScreenAnalysisInSameState"));

check("fresh bubble default uses the calibrated reference anchor", overlay.includes("0.285f") && overlay.includes("0.06f") && bubbleTest.includes("referenceTopX(1080, 68, 20, 1020) == 274") && bubbleTest.includes("referenceTopY(1920, 20, 1840) == 135"));
check("saved normalized bubble position remains the restore authority", overlay.includes("positionFromNormalized") && service.includes("applyInitialGtoBubblePosition") && service.includes("bubbleGtoXNorm"));
check("manual route buttons have one centralized selected style", service.includes("styleManualRouteOption") && service.includes("selected ? Color.rgb(224, 255, 249)") && service.includes("selected ? Color.argb(220, 20, 126, 114)"));
check("origin selection is visibly preserved on destination step", service.includes('Button selectedOrigin = menuButton("Origem selecionada: " + selectedOriginValue)') && service.includes("selectedOrigin.setBackground"));
check("destination/origin selection reads the persisted current value", service.includes('prefs.getString("reviewOrigin", "").trim()') && service.includes('prefs.getString("reviewDestination", "").trim()') && service.includes("boolean selected ="));
check("route picker keeps ordered steps and existing scroll contract", hf174.includes("Etapa 1/2") && hf174.includes("Etapa 2/2") && hf174.includes("rolagem é preservada"));
check("selection remains human-backed and transaction-bound", service.includes("GtoSelectionEvidencePolicy.mayConfirmSelection") && service.includes("buildSelectionTransaction") && service.includes("persistSelectionIdentity(row, \"TOUCH_LOCKED\""));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} HF183 flow-stability checks passed.`);
if (failed) process.exit(1);

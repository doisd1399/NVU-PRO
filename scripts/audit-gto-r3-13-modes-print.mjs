import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const profile = read("src/pages/driver/Profile.tsx");
const record = read("src/pages/driver/RecordTrip.tsx");
const dialog = read("src/components/GtoWorkModeDialog.tsx");
const ocr = read("src/services/gtoOcrService.ts");
const launcher = read("src/services/gtoWorkLauncher.ts");
const gradle = fs.existsSync("android/app/build.gradle") ? read("android/app/build.gradle") : "";

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
};

check("Current Android release is 1.0.45 / 45 when Android project is present",
  !gradle || (Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0) >= 48 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0) >= 48));

check("GTO mode dialog exposes print and automatic choices",
  dialog.includes("Modo print") && dialog.includes("Modo automático"));

check("mode selector is GTO-only in Dashboard",
  dashboard.includes("if (!isGtoWork)") &&
  dashboard.includes("setIsGtoModeDialogOpen(true)") &&
  dashboard.indexOf("setIsGtoModeDialogOpen(true)") > dashboard.indexOf("if (!isGtoWork)"));

check("mode selector is GTO-only in Profile",
  profile.includes("if (!isGtoWork)") &&
  profile.includes("setIsGtoModeDialogOpen(true)") &&
  profile.indexOf("setIsGtoModeDialogOpen(true)") > profile.indexOf("if (!isGtoWork)"));

check("print choice opens manual trip page with persistent query mode",
  dashboard.includes('navigate("/driver/trip?mode=print")') &&
  profile.includes('navigate("/driver/trip?mode=print")') &&
  record.includes('new URLSearchParams(location.search).get("mode")'));

check("automatic choice retains native launchGtoWork flow",
  dashboard.includes("await startGtoAutomatic()") &&
  profile.includes("await startGtoAutomatic()") &&
  launcher.includes("GtoObserver.openGto()") &&
  !launcher.includes("GtoObserver.requestScreenCapture()"));

check("direct GTO trip route offers both modes",
  record.includes("Modo print") &&
  record.includes("Modo automático") &&
  record.includes('resolvedSimulatorCode === "GTO" && !isGtoPrintMode'));

check("GTO print mode exposes the manual form",
  record.includes('isGtoPrintMode = resolvedSimulatorCode === "GTO" && gtoMode === "print"') &&
  record.includes("GTO · Modo print"));

check("GTO print keeps origin/destination editable even for detailed contracts",
  record.includes("!isGtoPrintMode &&") &&
  record.includes('activeContract?.mode === "detailed"'));

check("GTO print OCR still auto-fills earnings",
  record.includes("analyzeGtoTripReceipt(file)") &&
  record.includes("setValor(analysis.value)") &&
  ocr.includes("extractValueFromText"));

check("receipt analysis uses one broad pass and narrow value fallback",
  ocr.includes("buildResultAnalysisCanvas") &&
  ocr.includes("if (!value)") &&
  ocr.includes("buildValueBandCanvas(file)"));

check("normal Dobrar valor button alone is not treated as watched-ad proof",
  ocr.includes('Intentionally do not treat the normal') &&
  !ocr.includes('normalized.includes("dobrar valor")'));

check("strong doubled/ad confirmation patterns are present",
  ocr.includes("valor-dobrado") &&
  ocr.includes("midia-assistida") &&
  ocr.includes("recompensa-recebida") &&
  ocr.includes("dobro-confirmado-com-anuncio"));

check("GTO print waits for OCR before submit",
  record.includes('gtoReceiptAnalysisStatus === "reading"') &&
  record.includes("Aguarde a NVU terminar a análise do print."));

check("GTO print keeps OCR independent from receipt upload while submit remains gated",
  record.includes("void analyzeGtoTripReceipt(file)") &&
  record.includes('phase = "firebase-upload"') &&
  record.includes('gtoReceiptAnalysisStatus === "reading"') &&
  record.includes("Aguarde a NVU terminar a análise do print."));

check("unreadable GTO print requires explicit audited manual fallback",
  record.includes('gtoReceiptAnalysisStatus === "failed" && !gtoManualConfirmed') &&
  record.includes("marque a confirmação manual para continuar") &&
  record.includes("gtoReceiptManualConfirmation") &&
  record.includes("gtoReceiptReviewRequired"));

check("confirmed rewarded-ad/doubled print is blocked",
  record.includes("gtoAdDoubleDetected") &&
  record.includes("Viagem bloqueada: o print indica anúncio/valor dobrado."));

check("accepted print stores explicit audit mode",
  record.includes('gtoEntryMode: "print"') &&
  record.includes("gtoReceiptAnalyzed") &&
  record.includes("gtoRewardedAdDetected: false"));

check("non-GTO flow remains manual and unchanged in entry behavior",
  dashboard.includes('if (!isGtoWork)') &&
  dashboard.includes('navigate("/driver/trip")') &&
  profile.includes('if (!isGtoWork)') &&
  profile.includes('navigate("/driver/trip")'));

check("automatic backend contract remains untouched by mode selector",
  launcher.includes("contextAlreadyClosed") &&
  launcher.includes("observerReportsClosedJob") &&
  launcher.includes('status: "opened"'));

const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} R3.13 GTO mode/print checks passed.`);
if (failed.length) process.exit(1);

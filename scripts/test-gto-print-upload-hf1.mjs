import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const record = read("src/pages/driver/RecordTrip.tsx");
const ocr = read("src/services/gtoOcrService.ts");
const upload = read("src/services/uploadService.ts");
const timeout = read("src/lib/asyncTimeout.ts");
const pkg = JSON.parse(read("package.json"));

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
};

check(
  "GTO OCR is detached from the upload critical path",
  record.includes("void analyzeGtoTripReceipt(file)") &&
    record.indexOf("void analyzeGtoTripReceipt(file)") <
      record.indexOf('phase = "firebase-upload"'),
);
check(
  "UI separates preparing/validating from real upload progress",
  record.includes('type ReceiptUploadPhase = "idle" | "preparing" | "validating" | "uploading"') &&
    record.includes('uploadPhase === "uploading"') &&
    record.includes("Validando comprovante...") &&
    record.includes("Preparando comprovante..."),
);
check(
  "hash and duplicate checks are bounded",
  record.includes("generateImageHash(bytes, file),\n          10_000") &&
    record.includes("TripsRepository.checkImageHash(hash),\n          12_000"),
);
check(
  "unreadable OCR has explicit manual audited fallback",
  record.includes('gtoReceiptAnalysisStatus === "failed" && !gtoManualConfirmed') &&
    record.includes("gtoReceiptManualConfirmation") &&
    record.includes("gtoReceiptReviewRequired") &&
    record.includes('"manual-fallback"'),
);
check(
  "positive ADS/double evidence still blocks launch",
  record.includes("Viagem bloqueada: o print indica anúncio/valor dobrado.") &&
    record.includes('gtoReceiptAnalysisStatus === "blocked"'),
);
check(
  "small receipts skip unnecessary compression",
  upload.includes("if (file.size >= maxOutputBytes) {") &&
    upload.includes("Do not spend CPU/RAM recompressing screenshots"),
);
check(
  "Firebase auth/compression/upload have finite timeouts",
  upload.includes("authTimeoutMs = 12_000") &&
    upload.includes("compressionTimeoutMs = 30_000") &&
    upload.includes("uploadTimeoutMs = 90_000") &&
    upload.includes("uploadTask.cancel()"),
);
check(
  "OCR requires multiple result-screen clues",
  ocr.includes("detectResultScreenEvidence") &&
    ocr.includes("valid: evidence.length >= 2") &&
    !ocr.includes("analysisOk: Boolean(combinedText)"),
);
check(
  "OCR points worker/core/language to local app assets",
  ocr.includes('LOCAL_TESSERACT_WORKER_PATH = "/tesseract/worker.min.js"') &&
    ocr.includes('LOCAL_TESSERACT_CORE_PATH = "/tesseract/core"') &&
    ocr.includes('LOCAL_TESSDATA_PATH = "/tessdata"') &&
    ocr.includes("workerPath: LOCAL_TESSERACT_WORKER_PATH") &&
    ocr.includes("corePath: LOCAL_TESSERACT_CORE_PATH"),
);
check(
  "English traineddata is bundled",
  fs.existsSync("public/tessdata/eng.traineddata.gz") &&
    fs.statSync("public/tessdata/eng.traineddata.gz").size > 500_000,
);
check(
  "dev/build prepare local OCR runtime assets",
  pkg.scripts?.["prepare:ocr-assets"] === "node scripts/prepare-tesseract-assets.mjs" &&
    pkg.scripts?.predev === "npm run prepare:ocr-assets" &&
    pkg.scripts?.prebuild === "npm run prepare:ocr-assets",
);
check(
  "generic async timeout helper is present",
  timeout.includes("Promise.race") && timeout.includes("NVU_ASYNC_TIMEOUT"),
);

console.log(`\n${passed}/${passed + failed} GTO print upload HF1 checks passed.`);
if (failed) process.exit(1);

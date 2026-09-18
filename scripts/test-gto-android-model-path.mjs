import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ocrSource = fs.readFileSync(
  path.join(root, "src/services/gtoOcrService.ts"),
  "utf8",
);
const assetPrep = fs.readFileSync(
  path.join(root, "scripts/prepare-tesseract-assets.mjs"),
  "utf8",
);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const checks = [
  [
    "GTO explicitly disables gzip for Android-compatible local model",
    ocrSource.includes("gzip: false"),
  ],
  [
    "asset preparation creates the uncompressed traineddata file",
    assetPrep.includes('eng.traineddata"') && assetPrep.includes("gunzip"),
  ],
  [
    "prebuild always prepares OCR assets",
    pkg.scripts?.prebuild === "npm run prepare:ocr-assets",
  ],
  [
    "compressed traineddata remains the source asset",
    fs.existsSync(path.join(root, "public/tessdata/eng.traineddata.gz")),
  ],
  [
    "uncompressed traineddata is currently present",
    fs.existsSync(path.join(root, "public/tessdata/eng.traineddata")),
  ],
];

let failed = false;
for (const [label, pass] of checks) {
  if (pass) console.log(`PASS ${label}`);
  else {
    failed = true;
    console.error(`FAIL ${label}`);
  }
}

if (failed) process.exit(1);
console.log(`GTO_ANDROID_MODEL_PATH_PASS ${checks.length}/${checks.length}`);

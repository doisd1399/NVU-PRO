import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const service = fs.readFileSync(
  path.join(root, "src/services/gtoOcrService.ts"),
  "utf8",
);

const checks = [
  [
    "portrait crop reaches the lower half of a complete Android screenshot",
    /const PORTRAIT_VALUE_CROP = \{[\s\S]{0,180}y: 0\.28[\s\S]{0,180}width: 0\.84[\s\S]{0,180}height: 0\.56/.test(
      service,
    ),
  ],
  [
    "GTO analysis runs both landscape and portrait value crops",
    /const valueCrops = \[[\s\S]{0,320}landscape-modal[\s\S]{0,320}portrait-screen[\s\S]{0,240}for \(const valueCrop of valueCrops\)/.test(
      service,
    ),
  ],
  [
    "numeric value pass runs before broad diagnostic OCR",
    service.indexOf("const valueCrops =") < service.indexOf("const resultCanvas ="),
  ],
  [
    "numeric value can be promoted before the analysis Promise settles",
    /onValueDetected\?\.\(candidate\)/.test(service) &&
      /onValueDetected: \(detectedValue\)/.test(
        fs.readFileSync(path.join(root, "src/pages/driver/RecordTrip.tsx"), "utf8"),
      ),
  ],
  [
    "numeric OCR pass restricts characters to monetary symbols and digits",
    /tessedit_char_whitelist: "0123456789\.,R\$VvAaLlOoRrEeCcBbTtNnGgUuIisS "/.test(service),
  ],
  [
    "worker parameter support is optional and cannot block OCR",
    /if \(typeof worker\.setParameters !== "function"\) return;[\s\S]{0,240}catch \(error\)/.test(
      service,
    ),
  ],
  [
    "broad diagnostic OCR is best-effort",
    /Broad OCR is deliberately best-effort[\s\S]*?broad diagnostic warning/.test(
      service,
    ),
  ],
  [
    "implicit cents are accepted only in contextual or targeted value matches",
    /normalizeMonetaryCandidate\(candidate, true\)/.test(service) &&
      /normalizeMonetaryCandidate\(match\[1\], true\)/.test(service),
  ],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed += 1;
}

if (failed > 0) {
  process.exitCode = 1;
  throw new Error(`${failed} GTO portrait-value checks failed`);
}

console.log(`GTO_PRINT_PORTRAIT_VALUE_PASS ${checks.length}/${checks.length}`);

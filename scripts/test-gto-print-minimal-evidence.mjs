import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ocr = fs.readFileSync(path.join(root, "src/services/gtoOcrService.ts"), "utf8");
const recordTrip = fs.readFileSync(path.join(root, "src/pages/driver/RecordTrip.tsx"), "utf8");

const checks = [
  ["OCR analysis is driven by a valid value and explicit fraud evidence", /analysisOk:\s*Boolean\(value\)\s*&&\s*!finalAdEvidence\.detected/.test(ocr)],
  ["RecordTrip promotes analysis.value before status handling", /if \(analysis\.value\) \{[\s\S]{0,420}setValor\(analysis\.value\)[\s\S]{0,260}setValorDetectadoAutomaticamente\(true\)/.test(recordTrip)],
  ["OCR value is marked as OCR source", /setValorDeteccaoMetodo\("ocr"\)/.test(recordTrip)],
  ["Explicit ad/doubled-value evidence remains blocking", /if \(analysis\.doubledByAd\) \{[\s\S]{0,260}setGtoReceiptAnalysisStatus\("blocked"\)/.test(recordTrip)],
  ["Unreadable value requests a clearer print", /Não foi possível ler o valor recebido\. Envie um print mais nítido para continuar\./.test(recordTrip)],
  ["Legacy manual confirmation state is removed", !recordTrip.includes("gtoManualConfirmed") && !recordTrip.includes('type="checkbox"')],
  ["Legacy broad analysis gate is not used before value promotion", !/if \(!analysis\.analysisOk\)/.test(recordTrip)],
  ["Print submit still rejects unreadable or pending OCR", /if \(gtoReceiptAnalysisStatus === "failed"\)[\s\S]{0,240}Não foi possível ler o valor recebido/.test(recordTrip) && /imagePreview && gtoReceiptAnalysisStatus !== "ok"/.test(recordTrip)],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed += 1;
}

if (failed > 0) {
  process.exitCode = 1;
  throw new Error(`${failed} GTO print minimal-evidence checks failed`);
}

console.log(`GTO_PRINT_MINIMAL_EVIDENCE_PASS ${checks.length}/${checks.length}`);

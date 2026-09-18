import assert from "node:assert/strict";
import { __gtoOcrTestUtils } from "../src/services/gtoOcrService.ts";

const { extractValueFromText, detectDoubledByAdEvidence } = __gtoOcrTestUtils;

const cases = [
  ["Valor a receber: R$ 14.800,00", "14.800,00"],
  ["Valor a receber R$ 14 800,00", "14.800,00"],
  ["Valor a receber 14 900 00", "14.900,00"],
  ["Valor a receber: 1480000", "14.800,00"],
  ["Concluído Valor a receber: R$ 14.800,00 Dobrar valor (ADS)", "14.800,00"],
  ["R$ 1.250,50", "1.250,50"],
];

for (const [input, expected] of cases) {
  assert.equal(
    extractValueFromText(input),
    expected,
    `valor não extraído corretamente: ${input}`,
  );
}

assert.equal(
  extractValueFromText("12:55 5G 90% FPS 31"),
  null,
  "texto de HUD não pode virar ganho",
);

assert.equal(
  detectDoubledByAdEvidence(
    "Concluído Valor a receber: R$ 14.800,00 Dobrar valor (ADS)",
  ).detected,
  false,
  "botão Dobrar valor [ADS] isolado não é fraude",
);

assert.equal(
  detectDoubledByAdEvidence(
    "Valor dobrado após anúncio assistido: R$ 29.600,00",
  ).detected,
  true,
  "anúncio assistido com valor dobrado continua bloqueado",
);

console.log(`GTO_OCR_VALUE_EXTRACTION_PASS ${cases.length + 4}/${cases.length + 4}`);

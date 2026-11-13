import assert from "node:assert/strict";
import { __gtoOcrTestUtils } from "../src/services/gtoOcrService.ts";
import { readGtoPrintEvidence } from "../functions/src/gtoPrintEvidence.ts";

const { extractValueFromText, detectDoubledByAdEvidence, resolveDissentingTranscripts } = __gtoOcrTestUtils;

const cases = [
  ["Valor a receber: R$ 14.800,00", "14.800,00"],
  ["Valor a receber R$ 14 800,00", "14.800,00"],
  ["Valor a receber 14 900 00", "14.900,00"],
  ["Valor a receber: 1480000", "14.800,00"],
  ["Concluído Valor a receber: R$ 14.800,00 Dobrar valor (ADS)", "14.800,00"],
  ["R$ 1.250,50", "1.250,50"],
  ["Valor a receber: R$ 39.694,00", "39.694,00"],
  // Print real (v89): a palavra seguinte ("obrar") não pode ser engolida pelo valor.
  ["Concluico Concluio vas Valor a receber RS 10.656,00 obrar valor s", "10.656,00"],
  ["Concluigo Valor a receber RS 10.658,00 obrar valor ae Receber", "10.658,00"],
  ["Valor a receber RS 1.250,5O obs", "1.250,50"],
];

for (const [input, expected] of cases) {
  assert.equal(
    extractValueFromText(input),
    expected,
    `valor não extraído corretamente: ${input}`,
  );
}

assert.equal(extractValueFromText("Valor a receber: R$ 101,00"), "101,00",
  "valor positivo baixo precisa ser preservado");

assert.equal(
  extractValueFromText("108", { allowImplicitCentsInGeneric: false }),
  null,
  "token genérico 108 não pode virar R$ 1,08",
);

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

// v89: uma região lê 10.658,00 (6→8) e as outras 10.656,00. A maioria vence e o
// texto discordante sai da evidência; um empate continua sendo conflito.
{
  const a = "Concluio vas Valor a receber RS 10.656,00 obrar valor";
  const b = "Concluigo Valor a receber RS 10.658,00 obrar valor ae Receber";
  const c = "Concluido Valor a receber: R$ 10.656,00 Dobrar valor Receber [ADS]";
  assert.equal(readGtoPrintEvidence([a, b, c].join(" ")).reason, "CONFLICT", "sem voto, a divergência continua conflito");
  const dissent = resolveDissentingTranscripts([a, b, c]);
  assert.deepEqual([...dissent], [b], "só a leitura minoritária é descartada");
  const kept = [a, b, c].filter((text) => !dissent.has(text)).join(" ");
  const reading = readGtoPrintEvidence(kept);
  assert.equal(reading.amountCents, 1065600);
  assert.equal(reading.reason, "CONTEXT");
  assert.equal(resolveDissentingTranscripts([a, b]).size, 0, "empate 1x1 não escolhe valor");
  assert.equal(resolveDissentingTranscripts([a, c]).size, 0, "concordância não descarta nada");
  assert.equal(resolveDissentingTranscripts(["Concluido sem valor", a, c]).size, 0, "texto sem valor não é dissidente");
}

import assert from "node:assert/strict";
import { validateProReceiptEvidence } from "../src/services/pro-universal/proReceiptAdapters";

const toe = validateProReceiptEvidence(
  "toe-3",
  "Resultados\nDistância alcançada 149 Km\nTempo gasto 7 h 38 m\nRenda total € 2.621\nBônus de 20%\nRemover Penalidades",
);
assert.equal(toe.validation.decision, "accept");
assert.equal(toe.evidence.currency, "EUR");
assert.equal(toe.evidence.amountCents, 262100);
assert.equal(toe.evidence.bonusEvidence, "OFFER_ONLY");
assert.equal(toe.evidence.resultScreenConfirmed, true);

const wtdsZero = validateProReceiptEvidence(
  "wtds",
  "Resultados\nGanhos da Viagem: $ 10.914,04\nDanos a Carga: 0%\nBônus Video ADS: 0 0\nTotal: $ 10.914,04",
);
assert.equal(wtdsZero.validation.decision, "accept");
assert.equal(wtdsZero.evidence.bonusEvidence, "ZERO_LABEL");
assert.equal(wtdsZero.evidence.amountCents, 1091404);

const wbdsZero = validateProReceiptEvidence(
  "wbds",
  "Resultados\nGanhos da Viagem: R$ 2.500,00\nDanos a Carga: 0%\nBônus Video ADS: 0\nTotal: R$ 2.500,00",
);
assert.equal(wbdsZero.validation.decision, "accept");
assert.equal(wbdsZero.evidence.bonusEvidence, "ZERO_LABEL");

const wtdsPositive = validateProReceiptEvidence(
  "wtds",
  "Resultados\nGanhos da Viagem: $ 10.914,04\nDanos a Carga: 0%\nBônus Video ADS: 500 500\nTotal: $ 11.414,04",
);
assert.equal(wtdsPositive.validation.decision, "reject");
assert.equal(wtdsPositive.evidence.bonusEvidence, "POSITIVE");

const gto = validateProReceiptEvidence(
  "global-truck",
  "Concluído\nValor a receber: R$ 5.300,00\nReceber\nDobrar valor (ADS)",
);
assert.equal(gto.validation.decision, "accept");
assert.equal(gto.evidence.amountCents, 530000);
assert.equal(gto.evidence.currency, "BRL");
assert.equal(gto.evidence.resultScreenConfirmed, true);

const conflictingGto = validateProReceiptEvidence(
  "global-truck",
  "Concluído\nValor a receber: R$ 5.300,00\nTotal: R$ 5,30\nReceber",
);
assert.equal(conflictingGto.validation.decision, "reject");
assert.equal(conflictingGto.evidence.amountCents, 0);
assert.match(conflictingGto.validation.reasons.join(" "), /conflitantes/);

console.log("pro-receipt-adapters: PASS TOE3/GTO exact amount, WTDS/WBDS zero ADS, positive bonus and conflict rejection");

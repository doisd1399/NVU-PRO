import assert from "node:assert/strict";
import { __gtoOcrTestUtils } from "../src/services/gtoOcrService.ts";
const { extractValueFromText, selectValidatedValueCandidate } = __gtoOcrTestUtils;

const amounts = ["0,01", "1,00", "9,99", "85,60", "999,99", "1.000,00", "12.449,00", "38.450,00", "43.008,00", "999.999,99"];
assert.equal(extractValueFromText("Concluído Valor a receber: R$ 0,00 Receber"), null, "zero remains invalid");
for (const amount of amounts) {
  assert.equal(extractValueFromText(`Concluído Valor a receber: R$ ${amount} Receber`), amount);
  assert.equal(selectValidatedValueCandidate([
    { value: "5,08", text: "17:00 5 08", crop: "hud", contextual: false },
    { value: amount, text: `Valor a receber R$ ${amount}`, crop: "modal-a", contextual: true },
    { value: amount, text: `Concluído Valor a receber R$ ${amount}`, crop: "modal-b", contextual: true },
  ]), amount, `contextual amount must win: ${amount}`);
}
assert.equal(selectValidatedValueCandidate([
  { value: "5,08", text: "HUD 5,08", crop: "a", contextual: false },
]), null, "single HUD number must fail closed");
assert.equal(selectValidatedValueCandidate([
  { value: "43.008,00", text: "43008,00", crop: "a", contextual: false },
  { value: "43.008,00", text: "43008,00", crop: "b", contextual: false },
]), "43.008,00", "two independent generic crops may establish consensus");
assert.equal(selectValidatedValueCandidate([
  { value: "43.008,00", text: "Valor a receber 43.008,00", crop: "a", contextual: true },
  { value: "38.450,00", text: "Valor a receber 38.450,00", crop: "b", contextual: true },
]), null, "equal conflicting contextual evidence must fail closed");
console.log(`GTO_VALUE_CONSENSUS_PASS ${amounts.length * 2 + 8}/${amounts.length * 2 + 8}`);

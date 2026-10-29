import { parseWorldTripRoiValue } from "../src/services/worldTripOcrService.ts";

const cases = [
  ["FPS presente e payout legível", "4\n10914,04\n2 6 6", "10.914,04"],
  ["EXP presente e payout legível", "EXP 1091\n$ 10914,04", "10.914,04"],
  ["payout com ponto decimal", "10914.04\n80", "10.914,04"],
  ["payout com espaços e símbolo", "$ 10 914 , 04\n39", "10.914,04"],
  ["payout ilegível + FPS", "FPS 80\n---", null],
  ["payout ilegível + EXP", "EXP 1091\nnoise", null],
  ["somente números fora da ROI", "80\n1091\n39\n0", null],
  ["ROI monetária vazia", "", null],
  ["payout sem evidência decimal", "10914", null],
  ["dois payouts conflitantes", "10914,04\n10915,04", null],
];

for (const [name, raw, expected] of cases) {
  const actual = parseWorldTripRoiValue(raw);
  if (actual !== expected) {
    throw new Error(`${name}: esperado=${expected} atual=${actual}`);
  }
  console.log(`PASS: ${name} -> ${actual ?? "null"}`);
}
console.log(`WORLD_TRIP_OCR_ADVERSARIAL_PASS ${cases.length}/${cases.length}`);

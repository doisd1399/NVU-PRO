import assert from "node:assert/strict";
import { rankingCompanyDisplayName, rankingDisplayName } from "../src/lib/rankingDisplayName.ts";

const cases = [
  ["MATECOM", "Matecom"],
  ["COCAL TRANSPORTE", "Cocal Transporte"],
  ["Cooper log Transporte e Logística", "Cooper Log"],
  ["  SÃO   JOSÉ TRANSPORTES ", "São José"],
  ["D'ÁVILA LOGÍSTICA LTDA", "D'Ávila Logística"],
  ["RODA-CERTA EXPRESS", "Roda-Certa Express"],
  [null, ""],
];
for (const [input, expected] of cases) assert.equal(rankingCompanyDisplayName(input), expected);
assert.equal(rankingDisplayName("  Thiago   Caetano da Silva "), "Thiago Caetano", "Driver labels keep their existing casing policy");
assert.equal(rankingDisplayName("MATECOM"), "MATECOM", "Formatting companies does not alter the shared driver formatter");
console.log(`ranking-company-display-name: PASS (${cases.length + 2} cases)`);

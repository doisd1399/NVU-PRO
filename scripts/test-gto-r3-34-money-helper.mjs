import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { finalValueCompatibilityIssue, parsePositiveNumber } = require("../functions/lib/gtoMoney.js");

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

requireCheck(parsePositiveNumber("R$ 5.300,00") === 5300, "5.300,00 must parse as 5300");
requireCheck(parsePositiveNumber("R$ 5.300") === 5300, "5.300 must parse as 5300");
requireCheck(parsePositiveNumber("R$ 5300,00") === 5300, "5300,00 must parse as 5300");
requireCheck(parsePositiveNumber("R$ 5300.50") === 5300.5, "5300.50 must preserve cents");
requireCheck(parsePositiveNumber("R$ 5.300,50") === 5300.5, "5.300,50 must preserve cents");
requireCheck(finalValueCompatibilityIssue(5300, 530000) !== null, "100x corruption must be rejected");
requireCheck(finalValueCompatibilityIssue(5300, 5300) === null, "normal payout must be accepted");
requireCheck(finalValueCompatibilityIssue(5300, 10600) === null, "2x value is not rejected by broad corruption guard");
console.log("GtoMoney backend helper: PASS");

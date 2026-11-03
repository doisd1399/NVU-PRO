import assert from "node:assert/strict";
import { goalCurrencySymbol, goalRevenueIn, nativeGoalCurrency, resolveGoalCurrency } from "../src/lib/goalCurrency.ts";

const group = (currency: string | null, value: number, tripCount: number, currencyStatus = "known") => ({ currency, value, tripCount, currencyStatus });

// moeda interna do jogo
for (const [id, currency] of [["ats", "USD"], ["ATS", "USD"], ["american-truck-simulator", "USD"], ["ets2", "EUR"], ["ETS-2", "EUR"], ["euro-truck-simulator-2", "EUR"], ["gto", "BRL"], ["", "BRL"], [undefined, "BRL"], ["thats", "BRL"], ["ets22", "BRL"]] as const)
  assert.equal(nativeGoalCurrency(id), currency, String(id));

// a meta segue a moeda em que a empresa recebe: viagens do Windows em US$ no ATS contam na meta (antes só R$ contava e o progresso ficava em 0%)
assert.equal(resolveGoalCurrency("ats", [group("USD", 118811, 6)]), "USD");
assert.equal(goalRevenueIn([group("USD", 118811, 6)], "USD"), 118811);
assert.equal(resolveGoalCurrency("ets2", [group("EUR", 5000, 2)]), "EUR");
// empresa que lança por comprovante em reais continua em reais, mesmo no ATS
assert.equal(resolveGoalCurrency("ats", [group("BRL", 80000, 9)]), "BRL");
// sem viagens no período: a moeda do jogo
assert.equal(resolveGoalCurrency("ats", []), "USD"); assert.equal(resolveGoalCurrency("ets2", []), "EUR"); assert.equal(resolveGoalCurrency("gto", []), "BRL");
// mais de uma moeda: a de mais viagens; empate: a do jogo; nunca soma moedas diferentes
assert.equal(resolveGoalCurrency("ats", [group("BRL", 1000, 3), group("USD", 90000, 5)]), "USD");
assert.equal(resolveGoalCurrency("ats", [group("USD", 90000, 3), group("BRL", 1000, 5)]), "BRL");
assert.equal(resolveGoalCurrency("ats", [group("BRL", 1000, 4), group("USD", 90000, 4)]), "USD");
assert.equal(resolveGoalCurrency("ets2", [group("USD", 1000, 4), group("EUR", 90000, 4)]), "EUR");
const mixed = [group("BRL", 1000, 3), group("USD", 90000, 5)];
assert.equal(goalRevenueIn(mixed, "USD"), 90000); assert.equal(goalRevenueIn(mixed, "BRL"), 1000); assert.equal(goalRevenueIn(mixed, "EUR"), 0);
// moeda desconhecida, ausente ou em conflito nunca entra
assert.equal(resolveGoalCurrency("ats", [group(null, 5, 3, "missing"), group("USD", 7, 1, "unknown")]), "USD");
assert.equal(resolveGoalCurrency("ats", [group("BRL", 5, 3, "conflict")]), "USD");
assert.equal(goalRevenueIn([group("USD", 7, 1, "unknown")], "USD"), 0);
assert.equal(resolveGoalCurrency("ats", [group("GBP", 5, 3)]), "USD", "moeda fora da lista não vira meta");
assert.equal(resolveGoalCurrency("ats", [group("USD", 0, 0)]), "USD");
assert.deepEqual(["BRL", "USD", "EUR"].map(currency => goalCurrencySymbol(currency as never)), ["R$", "US$", "€"]);
console.log("GOAL_CURRENCY_PASS meta na moeda em que a empresa recebe (US$ ATS, € ETS2, R$ comprovantes), sem somar moedas");

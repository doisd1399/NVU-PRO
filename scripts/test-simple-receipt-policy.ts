import { validateSimpleReceiptText } from "../src/services/simpleAutomationReceiptPolicy";
import { readSimpleReceiptCurrency } from "../functions/src/tripReceiptPolicy";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`[simple-receipt] ${message}`);
};

const baseBus = validateSimpleReceiptText(
  "Concluído Valor a receber: R$ 10.785,00 Receber Dobrar valor (ADS)",
);
assert(baseBus.decision === "accept", "oferta ADS sem bônus aplicado deve aceitar o valor base");
assert(baseBus.amount === 10785, "valor base do WBDS não foi normalizado corretamente");

const baseTruck = validateSimpleReceiptText(
  "Resultados Ganhos da Viagem: $ 45863,47 Danos a Carga: 0% Bônus Video ADS: 0",
);
assert(baseTruck.decision === "accept", "resultado sem bônus deve ser aceito");
assert(baseTruck.amount === 45863.47, "valor base do caminhão não foi extraído");

const staticZeroAdLabel = validateSimpleReceiptText(
  "Resultados Ganhos da Viagem: $ 45863,47\nBônus Video ADS: 0 0\nTotal: $ 45863,47\nAnúncio Assistido disponível",
);
assert(staticZeroAdLabel.decision === "accept", "rótulo ADS estático com valor zero deve ser aceito");

const zeroWithFollowingTotal = validateSimpleReceiptText(
  "Resultados\nBônus Video ADS: 0\nGanhos da Viagem: $ 10914,04\nTotal: $ 10914,04",
);
assert(zeroWithFollowingTotal.decision === "accept", "total posterior não pode ser confundido com bônus ADS");
assert(zeroWithFollowingTotal.amount === 10914.04, "total posterior deve continuar sendo o valor base");

const rewarded = validateSimpleReceiptText(
  "Resultados Ganhos da Viagem: $ 7401,38\nBônus Video ADS: $ 7401,38\nTotal: $ 14802,76",
);
assert(rewarded.decision === "reject", "bônus ADS aplicado deve ser rejeitado");
assert(rewarded.reasons.length > 0, "rejeição ADS deve possuir motivo");

const doubled = validateSimpleReceiptText(
  "Resultados Ganhos da Viagem: $ 7401,38\nValor duplicado: $ 14802,76",
);
assert(doubled.decision === "reject", "valor duplicado deve ser rejeitado");

const multiplied = validateSimpleReceiptText(
  "Resultados Ganhos da Viagem: $ 7401,38\n2X: $ 14802,76",
);
assert(multiplied.decision === "reject", "multiplicador 2X com valor aplicado deve ser rejeitado");

const offerOnly = validateSimpleReceiptText("Resultados Dobrar valor (ADS) OK");
assert(offerOnly.decision === "review", "oferta sem valor base deve ficar em revisão");

const toe3OfferWithoutAppliedBonus = validateSimpleReceiptText(
  "Resultados\nDistância acionada: 208 Km\nRenda total: € 2.621\nBônus de 20%\nContinuar\nRemover Penalidades",
);
assert(toe3OfferWithoutAppliedBonus.decision === "accept", "oferta visual de 20% do TOE 3 não é bônus aplicado");
assert(toe3OfferWithoutAppliedBonus.amount === 2621, "valor europeu € 2.621 deve ser normalizado para 2621");

const toe3AppliedBonus = validateSimpleReceiptText(
  "Resultados\nRenda total: € 2.621\nBônus Video ADS: € 524,20\nTotal: € 3.145,20",
);
assert(toe3AppliedBonus.decision === "reject", "bônus numérico aplicado no TOE 3 deve ser rejeitado");

const toe3AppliedMultiplier = validateSimpleReceiptText(
  "Resultados\nRenda total: € 2.621\n2X: € 5.242,00",
);
assert(toe3AppliedMultiplier.decision === "reject", "multiplicador aplicado no TOE 3 deve ser rejeitado");

const explicitBrl = readSimpleReceiptCurrency("global-truck", "Concluído Valor a receber: R$ 4.099,00");
assert(explicitBrl.status === "known" && explicitBrl.currency === "BRL", "R$ explícito deve resolver BRL server-side");
assert(readSimpleReceiptCurrency("global-truck", "Valor a receber: R$ 100,00 Bônus Video ADS: 0").status === "known",
  "token de interface ADS não deve contaminar moeda explícita próxima ao valor");
assert(readSimpleReceiptCurrency("global-truck", "Valor a receber: R$ 100,00 GBP 100,00").status === "conflict",
  "código de moeda diferente depois do valor não pode ser ignorado");
const explicitEur = readSimpleReceiptCurrency("toe-3", "Renda total: € 4,099.00");
assert(explicitEur.status === "known" && explicitEur.currency === "EUR", "€ explícito deve resolver EUR server-side");
assert(readSimpleReceiptCurrency("toe-3", "Renda total: $ 6,547").status === "unknown", "$ isolado não deve ser mapeado a USD nem a EUR");
assert(readSimpleReceiptCurrency("toe-3", "Renda total: 6.547,00").status === "unknown", "simulador ou formato do número não deve inferir moeda");
assert(readSimpleReceiptCurrency("global-truck", "Valor a receber: R$ 100,00 EUR 100,00").status === "conflict",
  "tokens de moedas diferentes no mesmo campo de valor devem produzir CONFLICT");

console.log("[simple-receipt] receipt amount/bonus gates and explicit currency evidence passed");

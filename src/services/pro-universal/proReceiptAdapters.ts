import {
  validateSimpleReceiptText,
  simpleReceiptTextHasAdBonus,
  type SimpleReceiptValidation,
} from "../simpleAutomationReceiptPolicy";
import {
  getProSimulatorDefinition,
  type ProReceiptEvidence,
  type ProSimulatorKey,
} from "./proUniversalContracts";

export type ProReceiptAdapterResult = {
  evidence: ProReceiptEvidence;
  validation: SimpleReceiptValidation;
};

const normalized = (value: string): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

function classifyBonus(rawText: string, simulatorKey: ProSimulatorKey): ProReceiptEvidence["bonusEvidence"] {
  const text = normalized(rawText);
  const definition = getProSimulatorDefinition(simulatorKey);
  const hasLabel = definition?.resultScreen.bonusLabels.some((label) => text.includes(normalized(label))) || false;
  if (simpleReceiptTextHasAdBonus(rawText)) {
    return /DOBRADO|DUPLICAD|2\s*[X×]|X\s*2|X2|VALOR\s+DOBRADO|VALOR\s+DUPLICADO/.test(text)
      ? "DUPLICATED"
      : "POSITIVE";
  }
  if (hasLabel && /(?:ADS|BONUS|BÔNUS|BONUS\s+DE)\s*[:=]?\s*0(?:\s+0)?\b/.test(text)) return "ZERO_LABEL";
  if (hasLabel && /BONUS\s+DE\s+\d+\s*%|REMOVER\s+PENALIDADES|DOBRAR\s+VALOR/.test(text)) return "OFFER_ONLY";
  return "NONE";
}

export function validateProReceiptEvidence(
  simulatorKey: ProSimulatorKey,
  rawText: string,
): ProReceiptAdapterResult {
  const definition = getProSimulatorDefinition(simulatorKey);
  if (!definition) throw new Error("PRO_SIMULATOR_NOT_REGISTERED");
  const validation = validateSimpleReceiptText(rawText, {
    amountLabels: Array.from(new Set([
      ...definition.resultScreen.amountLabels,
      "valor a receber",
      "ganhos da viagem",
      "ganho da viagem",
      "renda total",
      "total",
    ])),
    requiredMarkers: definition.resultScreen.requiredMarkers,
  });
  const amountCents = validation.amount === null ? 0 : Math.round(validation.amount * 100);
  const bonusEvidence = classifyBonus(rawText, simulatorKey);
  const resultScreenConfirmed = validation.amount !== null
    && validation.decision !== "reject"
    && validation.reasons.every((reason) => !reason.includes("marcador confiável"));
  const evidence: ProReceiptEvidence = {
    simulatorKey,
    amountCents,
    currency: definition.locale.currency,
    baseReceiptFound: validation.amount !== null,
    resultScreenConfirmed,
    bonusEvidence,
    confidence: validation.amount !== null && validation.decision === "accept" && resultScreenConfirmed ? 1 : 0.5,
  };
  return { evidence, validation };
}

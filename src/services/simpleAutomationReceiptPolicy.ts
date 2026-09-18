export type SimpleReceiptDecision = "accept" | "reject" | "review";

export type SimpleReceiptCandidate = {
  amount: number;
  field: string;
  line: string;
};

export type SimpleReceiptValidation = {
  decision: SimpleReceiptDecision;
  amount: number | null;
  currency: "BRL" | "EUR" | "UNKNOWN";
  reasons: string[];
  sourceField: string | null;
  candidates?: SimpleReceiptCandidate[];
};

export type SimpleReceiptValidationOptions = {
  amountLabels?: readonly string[];
  requiredMarkers?: readonly string[];
};

const DEFAULT_AMOUNT_LABELS = [
  "VALOR A RECEBER",
  "GANHOS DA VIAGEM",
  "GANHO DA VIAGEM",
  "RENDA TOTAL",
  "TOTAL",
] as const;

const normalizeReceiptLine = (text: string): string =>
  String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizedLabel = (label: string): string => normalizeReceiptLine(label);

const normalizeReceiptText = (text: string): string =>
  String(text || "")
    .split(/\r?\n/)
    .map(normalizeReceiptLine)
    .filter(Boolean)
    .join(" ");

const rewardEvidenceLines = (text: string): string[] =>
  String(text || "")
    .split(/\r?\n/)
    .map(normalizeReceiptLine)
    .filter(Boolean);

function parseAmount(value: string): number | null {
  const cleaned = String(value || "")
    .replace(/[^0-9,.-]/g, "")
    .trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(?:\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

const amountPattern = /(?:R\$|\$|€|EUR|BRL)?\s*([0-9]+(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/i;
const standaloneAmountPattern = /^(?:R\$|\$|€|EUR|BRL)?\s*([0-9]+(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)\s*$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findAmountCandidates(
  rawText: string,
  labels: readonly string[],
): SimpleReceiptCandidate[] {
  const lines = rewardEvidenceLines(rawText);
  const normalizedLabels = Array.from(
    new Set(labels.map(normalizedLabel).filter(Boolean)),
  ).sort((left, right) => right.length - left.length);
  const candidates: SimpleReceiptCandidate[] = [];

  lines.forEach((line, lineIndex) => {
    normalizedLabels.forEach((label) => {
      const labelExpression = new RegExp(`${escapeRegExp(label)}[^0-9]{0,40}`, "i");
      const labelMatch = line.match(labelExpression);
      if (!labelMatch) return;
      const afterLabel = line.slice((labelMatch.index || 0) + labelMatch[0].length - 0);
      const amountMatch = afterLabel.match(amountPattern);
      const nextLine = lines[lineIndex + 1] || "";
      const continuedAmount = !amountMatch && standaloneAmountPattern.exec(nextLine);
      const rawAmount = amountMatch?.[1] || continuedAmount?.[1];
      if (!rawAmount) return;
      const amount = parseAmount(rawAmount);
      if (amount === null) return;
      candidates.push({ amount, field: label, line: continuedAmount ? `${line} ${nextLine}` : line });
    });
  });

  const unique = new Map<string, SimpleReceiptCandidate>();
  candidates.forEach((candidate) => {
    const key = `${candidate.field}:${candidate.amount}:${candidate.line}`;
    if (!unique.has(key)) unique.set(key, candidate);
  });
  return Array.from(unique.values());
}

function findAmountAfterLabel(
  text: string,
  labels: readonly string[],
): { amount: number | null; field: string | null; candidates: SimpleReceiptCandidate[] } {
  const candidates = findAmountCandidates(text, labels);
  const values = Array.from(new Set(candidates.map((candidate) => candidate.amount)));
  if (values.length !== 1) return { amount: null, field: null, candidates };
  const selected = candidates[0];
  return { amount: selected?.amount ?? null, field: selected?.field ?? null, candidates };
}

function hasNonZeroRewardValue(rawText: string): boolean {
  const rewardLabels = [
    "BONUS VIDEO ADS",
    "BONUS ADS",
    "BONUS DE ADS",
    "BONUS VIDEO",
    "VIDEO ADS",
  ];
  const nextField = /\b(?:TOTAL|VALOR\s+A\s+RECEBER|GANHOS?|GANHO|RENDA|DANOS?|ESTACIONAMENTO|EXP|NIVEL)\b/;

  for (const line of rewardEvidenceLines(rawText)) {
    for (const label of rewardLabels) {
      const labelIndex = line.indexOf(label);
      if (labelIndex < 0) continue;
      const sameRow = line.slice(labelIndex + label.length).split(nextField, 1)[0];
      const numericTokens = sameRow.match(/[0-9]+(?:[.][0-9]{3})*(?:,[0-9]{1,2})?/g) || [];
      if (numericTokens.some((token) => (parseAmount(token) || 0) > 0)) return true;
    }
  }
  return false;
}

function hasExplicitRewardAcceptanceEvidence(rawText: string): boolean {
  const terms = ["VALOR DOBRADO", "VALOR DUPLICADO", "DOBRADO", "DUPLICAD", "2 X", "2X", "2×", "X 2", "X2", "X×", "×2"];
  return rewardEvidenceLines(rawText).some((line) =>
    terms.some((term) => {
      const index = line.indexOf(term);
      if (index < 0) return false;
      const afterTerm = line.slice(index + term.length);
      const numericTokens = afterTerm.match(/[0-9]+(?:[.][0-9]{3})*(?:,[0-9]{1,2})?/g) || [];
      return numericTokens.some((token) => (parseAmount(token) || 0) > 0);
    }),
  );
}

export function validateSimpleReceiptText(
  rawText: string,
  options: SimpleReceiptValidationOptions = {},
): SimpleReceiptValidation {
  const text = normalizeReceiptText(rawText);
  const reasons: string[] = [];
  const labels = options.amountLabels?.length ? options.amountLabels : DEFAULT_AMOUNT_LABELS;
  const hasAdOffer = /DOBRAR\s+VALOR\s*\(?\s*ADS|REMOVER\s+PENALIDADES|BONUS\s+DE\s+[0-9]+\s*%|2\s*[X×]|X\s*2/.test(text);
  const hasRewardedValue = hasNonZeroRewardValue(rawText);
  const hasExplicitRewardAcceptance = hasExplicitRewardAcceptanceEvidence(rawText);
  const hasAdConfirmation = hasRewardedValue || hasExplicitRewardAcceptance;
  const hasBaseDialog = labels.some((label) => text.includes(normalizedLabel(label))) || /TOTAL\s*:/.test(text);
  const parsed = findAmountAfterLabel(rawText, labels);
  const distinctCandidateValues = Array.from(new Set(parsed.candidates.map((candidate) => candidate.amount)));

  if (hasRewardedValue || hasExplicitRewardAcceptance) {
    reasons.push("A evidência mostra recompensa ou bônus de anúncio aplicado.");
  }

  if (hasAdOffer && !hasBaseDialog) {
    reasons.push("A tela parece ser uma oferta ADS sem recibo base verificável.");
  }

  if (parsed.candidates.length === 0 || parsed.amount === null) {
    reasons.push("Captura fora da tela correta: abra a tela de conclusão/recebimento e capture novamente.");
  }

  if (distinctCandidateValues.length > 1) {
    reasons.push("A captura contém valores de recebimento conflitantes; nenhum valor será escolhido automaticamente.");
  }

  const requiredMarkers = (options.requiredMarkers || []).map(normalizedLabel).filter(Boolean);
  if (requiredMarkers.length > 0) {
    const markerFound = requiredMarkers.some((marker) => text.includes(marker));
    if (!markerFound) reasons.push("A tela não contém um marcador confiável do resultado do simulador selecionado.");
  }

  const decision: SimpleReceiptDecision = reasons.length > 0
    ? hasAdConfirmation || distinctCandidateValues.length > 1 ? "reject" : "review"
    : "accept";

  return {
    decision,
    amount: parsed.amount,
    currency: /€|EUR/.test(text) ? "EUR" : /R\$|BRL/.test(text) ? "BRL" : "UNKNOWN",
    reasons,
    sourceField: parsed.field,
    candidates: parsed.candidates,
  };
}

export function simpleReceiptTextHasAdBonus(rawText: string): boolean {
  return hasNonZeroRewardValue(rawText) || hasExplicitRewardAcceptanceEvidence(rawText);
}

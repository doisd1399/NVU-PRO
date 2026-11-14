/** Pure monetary helpers for GTO payload validation. */
export const parsePositiveNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned || cleaned.startsWith("-")) return 0;

  let normalized = cleaned;
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (comma >= 0) {
    const decimals = cleaned.length - comma - 1;
    normalized = decimals === 1 || decimals === 2
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (dot >= 0) {
    const dots = (cleaned.match(/\./g) || []).length;
    const decimals = cleaned.length - dot - 1;
    if (dots > 1 || decimals === 3) normalized = cleaned.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const finalValueCompatibilityIssue = (offeredValue: number, finalValue: number): string | null => {
  if (!(offeredValue > 0) || !(finalValue > 0)) return null;
  const ratio = finalValue / offeredValue;
  if (ratio >= 95 && ratio <= 105) {
    return "Valor final incompatível com o frete: possível deslocamento de centavos (aprox. 100x).";
  }
  // Wide fail-safe range: blocks corrupt monetary semantics without rejecting
  // reasonable in-game adjustments. Normal Receive should ordinarily be close to 1x.
  if (ratio > 20 || ratio < 0.05) {
    return "Valor final incompatível com o valor ofertado do frete.";
  }
  return null;
};

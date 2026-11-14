/** Presentation-only label. Never use to identify a participant or mutate ranking records. */
export function rankingDisplayName(value: unknown): string {
  const words = String(value ?? "").trim().split(/\s+/u).filter(Boolean);
  return words.slice(0, 2).join(" ");
}

/** Company labels are short and consistently cased; stored names stay untouched. */
export function rankingCompanyDisplayName(value: unknown): string {
  return rankingDisplayName(value)
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s'’\-])\p{L}/gu, (initial) => initial.toLocaleUpperCase("pt-BR"));
}

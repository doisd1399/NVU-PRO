const money = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatGoalAmount(amount: number): string {
  return Number.isFinite(amount) && amount >= 0 ? money.format(amount) : "";
}

/** Group whole reais while retaining the decimal separator being edited. */
export function formatGoalDraft(value: string, editingDigit = false): string {
  const plain = value.replace(/[\s\u00a0]/g, "").replace(/^R\$/, "");
  if (!/^[\d.]*?(?:,\d{0,2})?$/.test(plain)) return value;
  const [whole, fraction] = plain.split(",");
  // Never silently turn a pasted decimal such as 1234.56 into 123456 reais.
  if (whole.includes(".") && !/^\d{1,3}(?:\.\d{3})+$/.test(whole) && !editingDigit) return value;
  const digits = whole.replace(/\./g, "").replace(/^0+(?=\d)/, "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (fraction !== undefined ? grouped || "0" : grouped) + (fraction === undefined ? "" : `,${fraction}`);
}

export function parseGoalAmount(value: string): number {
  const plain = value.trim().replace(/[\s\u00a0]/g, "").replace(/^R\$/, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(plain)) return NaN;
  const amount = Number(plain.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(amount) && amount > 0 && amount <= 1e15 ? amount : NaN;
}

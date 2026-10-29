/** Pure monetary parser shared with browser receipt validation. */
export function readReceiptAmountCents(raw: string): number | null {
  if (!/^[0-9][0-9.,]*$/.test(raw)) return null;
  const separator = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
  const fraction = separator < 0 ? "" : raw.slice(separator + 1);
  const decimal = fraction.length === 1 || fraction.length === 2;
  const whole = decimal ? raw.slice(0, separator) : raw;
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{1,3}(?:,[0-9]{3})+)$/.test(whole)) return null;
  const cents = Number(whole.replace(/[.,]/g, "")) * 100 + Number(decimal ? fraction.padEnd(2, "0") : "0");
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 1_000_000_000 ? cents : null;
}

/** WebViews with getRandomValues but without randomUUID still keep a strong
 * request identity. Never fall back to a clock or a nonpersistent counter. */
export function operationalRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `oc1_${Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error("Este aparelho não conseguiu gerar a confirmação. Atualize o aplicativo e tente novamente.");
}

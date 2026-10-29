/** Absolute app asset URL: nested routes must not request /driver/vendor/... */
export function localImageCompressionWorkerUrl(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const base = String(import.meta.env?.BASE_URL || "/");
  return new URL(`${base}vendor/browser-image-compression.js`, document.baseURI).href;
}

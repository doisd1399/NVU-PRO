import { Capacitor } from "@capacitor/core";
import type { ResolvedAppGuide } from "./appGuides";

const saveBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.rel = "noopener";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
};

/**
 * Baixa/abre o guia.
 * - Guia que acompanha o app (mesma origem): baixa pelo navegador/Windows; funciona sem internet.
 * - Guia enviado pelo Sênior (Firebase Storage): tenta baixar o arquivo; se o navegador não deixar (CORS) ou for o app Android,
 *   abre o endereço do arquivo no navegador do aparelho, de onde se salva/compartilha o PDF.
 */
export async function downloadAppGuide(guide: ResolvedAppGuide): Promise<void> {
  const native = Capacitor.isNativePlatform();
  if (guide.source === "uploaded") {
    if (!native) {
      try {
        const response = await fetch(guide.url, { credentials: "omit" });
        if (response.ok) { saveBlob(await response.blob(), guide.fileName); return; }
      } catch { /* cai para a abertura do endereço */ }
    }
    if (!window.open(guide.url, "_blank", "noopener")) window.location.assign(guide.url);
    return;
  }
  const response = await fetch(guide.url);
  if (!response.ok) throw new Error("guide-download-failed");
  saveBlob(await response.blob(), guide.fileName);
}

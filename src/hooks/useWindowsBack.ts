import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { dismissTopOptionModal } from "../lib/optionModalStack";
import { handleSafeRouteBack } from "../lib/safeBackNavigation";
import { isWindowsDesktop } from "../lib/windowsAutomation";

/**
 * O aplicativo Windows não tem o botão "voltar" do Android nem a barra do navegador. Este gancho oferece o mesmo "voltar":
 * um botão no cabeçalho (`canGoBack`), Alt+← e o botão "voltar" do mouse. Primeiro fecha a janela/seletor aberto; depois volta uma página.
 */
export function useWindowsBack(fallbackPath: string, fallbackState?: Record<string, unknown>) {
  const navigate = useNavigate(), location = useLocation();
  const windows = isWindowsDesktop();
  const index = Number(window.history.state?.idx);
  // `location.key` muda a cada navegação; ler o índice aqui garante que o botão reflita o estado atual.
  const canGoBack = windows && ((Number.isFinite(index) && index > 0) || (location.key !== "default" && window.history.length > 1));
  const goBack = () => { if (dismissTopOptionModal()) return; handleSafeRouteBack(navigate, fallbackPath, fallbackState); };
  useEffect(() => {
    if (!windows) return;
    const onKey = (event: KeyboardEvent) => { if (event.altKey && event.key === "ArrowLeft" && !event.ctrlKey && !event.metaKey && !(event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) { event.preventDefault(); goBack(); } };
    const onMouse = (event: MouseEvent) => { if (event.button === 3) { event.preventDefault(); goBack(); } };
    window.addEventListener("keydown", onKey); window.addEventListener("mouseup", onMouse);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mouseup", onMouse); };
  });
  return { canGoBack, goBack, windows };
}

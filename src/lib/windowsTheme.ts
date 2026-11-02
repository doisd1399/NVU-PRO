import { NVU_THEME_CHANGE_EVENT } from "../hooks/useTheme";
/** Apply native assistant preferences through the existing NVU theme store. */
export function applyWindowsTheme(theme: unknown) {
  if ((theme !== "light" && theme !== "dark") || typeof window === "undefined") return;
  if (document.documentElement.classList.contains("dark") !== (theme === "dark")) {
    window.dispatchEvent(new CustomEvent(NVU_THEME_CHANGE_EVENT, { detail: theme }));
  }
}

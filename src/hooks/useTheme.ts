import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
export const NVU_THEME_CHANGE_EVENT = "nvu:theme-change";
const STORAGE_KEY = "frotalog-theme";
const listeners = new Set<() => void>();
let currentTheme: Theme | undefined;

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch { /* Private/embedded storage must not block the visual theme. */ }
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getSnapshot(): Theme {
  return currentTheme ??= readStoredTheme();
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Do not remove/re-add the root theme whenever a header or page mounts.
  if (root.classList.contains("dark") !== (theme === "dark")) root.classList.toggle("dark", theme === "dark");
  if (root.classList.contains("light") !== (theme === "light")) root.classList.toggle("light", theme === "light");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.getAttribute("content") !== "transparent") meta.setAttribute("content", "transparent");
}

function publishTheme(theme: Theme, persist: boolean) {
  const changed = getSnapshot() !== theme;
  currentTheme = theme;
  applyTheme(theme);
  if (persist) {
    try { if (window.localStorage.getItem(STORAGE_KEY) !== theme) window.localStorage.setItem(STORAGE_KEY, theme); }
    catch { /* The in-memory theme remains authoritative for this session. */ }
  }
  if (changed) listeners.forEach(listener => listener());
}

const onThemeEvent = (event: Event) => {
  const next = (event as CustomEvent<Theme>).detail;
  if (next === "light" || next === "dark") publishTheme(next, true);
};
const onStorage = (event: StorageEvent) => {
  if (event.key === STORAGE_KEY) publishTheme(event.newValue === "dark" ? "dark" : "light", false);
};
function subscribe(listener: () => void) {
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first && typeof window !== "undefined") {
    window.addEventListener(NVU_THEME_CHANGE_EVENT, onThemeEvent);
    window.addEventListener("storage", onStorage);
    publishTheme(readStoredTheme(), false);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined") {
      window.removeEventListener(NVU_THEME_CHANGE_EVENT, onThemeEvent);
      window.removeEventListener("storage", onStorage);
    }
  };
}
function toggleTheme() {
  const next = getSnapshot() === "dark" ? "light" : "dark";
  publishTheme(next, true);
  window.dispatchEvent(new CustomEvent<Theme>(NVU_THEME_CHANGE_EVENT, { detail: next }));
}

/** One store, one pair of listeners and one DOM update per actual theme change. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "light" as Theme);
  return { theme, toggleTheme };
}

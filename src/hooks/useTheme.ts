import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export const NVU_THEME_CHANGE_EVENT = "nvu:theme-change";

const readStoredTheme = (): Theme => {
  try {
    return localStorage.getItem("frotalog-theme") === "dark" ? "dark" : "light";
  } catch {
    // Storage can be unavailable in embedded/private contexts. Theme must never
    // prevent the application from mounting.
    return "light";
  }
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);

    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "transparent");

    try {
      localStorage.setItem("frotalog-theme", theme);
    } catch {
      // The visual theme still applies even when persistence is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    const applyExternalTheme = (nextTheme: unknown) => {
      if (nextTheme === "light" || nextTheme === "dark") {
        setTheme(nextTheme);
      }
    };

    const handleThemeEvent = (event: Event) => {
      applyExternalTheme(
        (event as CustomEvent<Theme>).detail,
      );
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "frotalog-theme") applyExternalTheme(event.newValue);
    };

    window.addEventListener(NVU_THEME_CHANGE_EVENT, handleThemeEvent);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(NVU_THEME_CHANGE_EVENT, handleThemeEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    window.dispatchEvent(
      new CustomEvent<Theme>(NVU_THEME_CHANGE_EVENT, { detail: nextTheme }),
    );
  };

  return { theme, toggleTheme };
}

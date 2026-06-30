export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "qr-dashboard-theme";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", mode);
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getStoredTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

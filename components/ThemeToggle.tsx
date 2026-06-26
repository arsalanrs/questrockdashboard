"use client";

import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, type ThemeMode } from "@/lib/theme";

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function onToggle() {
    const next = getStoredTheme() === "light" ? "dark" : "light";
    applyTheme(next);
    setTheme(next);
  }

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={onToggle}
      className="theme-toggle flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      {isLight ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

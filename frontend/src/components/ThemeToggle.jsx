/**
 * ThemeToggle - switches the whole dashboard, charts included, between light
 * and dark. The icon shows the mode you would switch to.
 */

import { setColorScheme, useColorScheme } from "../utils/useColorScheme";

const SUN = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const MOON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

export default function ThemeToggle() {
  const scheme = useColorScheme();
  const next = scheme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="icon-button" onClick={() => setColorScheme(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {scheme === "dark" ? SUN : MOON}
    </button>
  );
}

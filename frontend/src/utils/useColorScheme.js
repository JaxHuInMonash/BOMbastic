import { useSyncExternalStore } from "react";

/**
 * The colour scheme, "light" or "dark", shared by the page and the charts.
 *
 * It follows the operating system until the user picks one with the toggle;
 * that choice is remembered in localStorage and wins from then on. The scheme
 * is written to <html data-theme>, which index.css keys its dark colours on
 * (index.html sets it before first paint, so there is no flash of light mode).
 */

const QUERY = "(prefers-color-scheme: dark)";
const STORAGE_KEY = "bombastic-theme";
const listeners = new Set();

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // storage blocked, e.g. a private window
  }
}

// The user's choice, or null to follow the system.
let choice = readStored();

function current() {
  return choice ?? (window.matchMedia(QUERY).matches ? "dark" : "light");
}

function apply() {
  document.documentElement.dataset.theme = current();
  listeners.forEach((onChange) => onChange());
}

if (typeof window !== "undefined") {
  apply();
  window.matchMedia(QUERY).addEventListener("change", apply);
}

function subscribe(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** "light" or "dark", updating live when the system or the toggle changes it. */
export function useColorScheme() {
  return useSyncExternalStore(subscribe, current, () => "light");
}

/** Choose a scheme and remember it (for this tab only if storage is blocked). */
export function setColorScheme(scheme) {
  choice = scheme;
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    // Not saved; it still applies until the page is reloaded.
  }
  apply();
}

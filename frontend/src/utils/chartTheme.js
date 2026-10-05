/**
 * Chart colours. Light and dark are each chosen, not inverted, and match the
 * CSS tokens in index.css. Plotly draws to SVG and cannot read CSS variables,
 * so the same values live here.
 */

export const PALETTE = {
  light: {
    rainfall: "#2a78d6", tmax: "#c8541a", tmin: "#1f7a8c",
    a: "#2a78d6", b: "#c8541a",
    ink: "#52514e", grid: "#e1e0d9", axis: "#c3c2b7", muted: "#898781", fit: "#0b0b0b",
  },
  dark: {
    rainfall: "#3987e5", tmax: "#e8814d", tmin: "#3fb0c4",
    a: "#3987e5", b: "#e8814d",
    ink: "#c3c2b7", grid: "#2c2c2a", axis: "#383835", muted: "#898781", fit: "#ffffff",
  },
};

export const seriesColor = (scheme, variableCode) => PALETTE[scheme][variableCode] ?? PALETTE[scheme].a;

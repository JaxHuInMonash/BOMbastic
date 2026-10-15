/**
 * Chart colours. Plotly draws to SVG/canvas and cannot read CSS variables, so
 * the values in index.css that charts need are repeated here.
 *
 * Light and dark are each chosen, not inverted (dataviz reference palette).
 * Series colours follow the variable, never its position on screen: maximum
 * temperature is always orange and minimum always blue, whichever is chosen.
 * Checked with the dataviz palette validator: the pair passes colour-vision-
 * deficiency separation in both modes (ΔE 24.7 light, 31.8 normal-vision dark).
 */

export const CHROME = {
  // band: the "not yet quality-checked" background (utils/quality.js), a neutral wash, never a status colour.
  light: { ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", surface: "#fcfcfb", band: "rgba(137, 135, 129, 0.16)" },
  dark: { ink: "#ffffff", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835", surface: "#1a1a19", band: "rgba(195, 194, 183, 0.11)" },
};

const SERIES = {
  light: { rainfall: "#2a78d6", tmax: "#eb6834", tmin: "#2a78d6" },
  dark: { rainfall: "#3987e5", tmax: "#d95926", tmin: "#3987e5" },
};

/** The colour for a variable in the given scheme ("light" or "dark"). */
export function seriesColor(scheme, variableCode) {
  return SERIES[scheme]?.[variableCode] ?? SERIES[scheme]?.rainfall ?? SERIES.light.rainfall;
}

/**
 * Compare view: colour follows the station, not the variable. A is slot 1
 * (blue), B is slot 2 (orange), the pair already validated above; the map
 * pins use the same two colours.
 */
const STATIONS = {
  light: { A: "#2a78d6", B: "#eb6834" },
  dark: { A: "#3987e5", B: "#d95926" },
};

export const stationColor = (scheme, which) => STATIONS[scheme][which];

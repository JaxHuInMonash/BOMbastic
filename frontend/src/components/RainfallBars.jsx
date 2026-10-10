/**
 * RainfallBars - daily rainfall columns (FR-02, NFR-05), for ranges up to
 * LONG_RANGE_DAYS and for the month picked in the calendar.
 *
 *   column            one day's reading; a dry day (0 mm) has no column
 *   wide pale column  a multi-day total, spanning the days it covers, as tall
 *                     as the total (the tooltip says it is a total)
 *   grey ×            no reading (or no record) on that day, on the baseline
 *
 * Every day has a tooltip, dry and missing days included: an invisible
 * full-height column per day is the hover target, so the reader aims at a
 * date, not at a 2px bar or a 0 mm day with nothing drawn.
 */

import { useMemo } from "react";
import { CHROME, seriesColor } from "../utils/chartTheme";
import { addDays } from "../utils/dates";
import { describeDay } from "../utils/rainfall";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

const DAY_MS = 86_400_000;
const midnight = (iso) => new Date(`${iso}T00:00:00Z`).getTime();

export default function RainfallBars({ days, start, end, revision, ariaLabel, height = 340 }) {
  const scheme = useColorScheme();
  const color = seriesColor(scheme, "rainfall");
  const muted = CHROME[scheme].muted;
  const surface = CHROME[scheme].surface;
  const short = days.length <= 62;

  const traces = useMemo(() => {
    const singles = days.filter((d) => d.kind === "value" && d.value > 0);
    const totals = [...new Map(days.filter((d) => d.kind === "multi").map((d) => [d.total.end, d.total])).values()];
    const gaps = days.filter((d) => d.kind === "missing" || d.kind === "norecord");
    const top = Math.max(1, ...singles.map((d) => d.value), ...totals.map((t) => t.value)) * 1.08;
    const tips = days.map(describeDay);

    const out = [{
      type: "bar",
      name: "Daily rainfall",
      x: singles.map((d) => d.date),
      y: singles.map((d) => d.value),
      width: DAY_MS * (short ? 0.7 : 0.8),
      marker: { color, line: { width: 0 } },
      hoverinfo: "skip",
    }];
    if (totals.length) {
      out.push({
        type: "bar",
        name: "Multi-day total",
        // Centred on the days it covers, one day wide per day covered, minus a small gap.
        x: totals.map((t) => new Date((midnight(t.start) + midnight(t.end)) / 2).toISOString()),
        y: totals.map((t) => t.value),
        width: totals.map((t) => t.span * DAY_MS - DAY_MS * 0.2),
        marker: { color: surface, line: { color, width: 1.5 }, pattern: { shape: "/", fgcolor: color, size: 6, solidity: 0.25 } },
        hoverinfo: "skip",
      });
    }
    if (gaps.length) {
      out.push({
        type: "scatter",
        mode: "markers",
        name: "No reading",
        x: gaps.map((d) => d.date),
        y: gaps.map(() => 0),
        marker: { symbol: "x-thin-open", size: short ? 9 : 7, color: muted, line: { width: 1.5, color: muted } },
        cliponaxis: false,
        hoverinfo: "skip",
      });
    }
    // Hover targets: one invisible full-height column per day.
    out.push({
      type: "bar",
      name: "",
      showlegend: false,
      x: days.map((d) => d.date),
      y: days.map(() => top),
      width: DAY_MS,
      marker: { color: "rgba(0,0,0,0)" },
      hovertemplate: "%{customdata}<extra></extra>",
      customdata: tips.map((t) => `<b>${t.value}</b><br>${t.date}<br>${t.status}`),
    });
    return { traces: out, top };
  }, [days, color, muted, surface, short]);

  const layout = useMemo(
    () => ({
      barmode: "overlay",
      bargap: 0,
      hovermode: "closest",
      xaxis: {
        type: "date",
        range: [`${addDays(start, -1)} 12:00`, `${end} 12:00`],
        showspikes: true,
        spikemode: "across",
        spikesnap: "cursor",
        spikethickness: 1,
        spikedash: "solid",
        spikecolor: CHROME[scheme].axis,
        ...(short ? { dtick: 7 * DAY_MS, tick0: start, tickformat: "%-d %b" } : {}),
      },
      yaxis: { title: { text: "Rainfall (mm)" }, range: [0, traces.top], fixedrange: false },
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom" },
    }),
    [start, end, short, scheme, traces.top],
  );

  return <PlotlyChart traces={traces.traces} layout={layout} revision={revision} ariaLabel={ariaLabel} height={height} />;
}


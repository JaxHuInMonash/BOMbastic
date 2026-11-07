/**
 * RainfallBars - daily rainfall columns (FR-02, NFR-05), for ranges up to
 * LONG_RANGE_DAYS and for the month picked in the calendar.
 *
 *   column            one day's reading; a dry day (0 mm) has no column
 *   wide striped      a multi-day total, spanning the days it covers, drawn at
 *   column            its average per day so its area is the rain measured;
 *                     the tooltip gives the total and says it is not a daily value
 *   grey ×            no reading (or no record) on that day, on the baseline
 *
 * Days BOM hasn't quality-checked yet sit on a pale band (utils/quality.js).
 *
 * Every day has a tooltip, dry and missing days included: an invisible
 * full-height column per day is the hover target, so the reader aims at a
 * date, not at a 2px bar or a 0 mm day with nothing drawn.
 */

import { useMemo } from "react";
import { CHROME, seriesColor } from "../utils/chartTheme";
import { addDays } from "../utils/dates";
import { describeDay, multiDayBlocks } from "../utils/rainfall";
import { bandLegend, bandShapes, unverifiedRuns } from "../utils/quality";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

const DAY_MS = 86_400_000;
const midnight = (iso) => new Date(`${iso}T00:00:00Z`).getTime();

export default function RainfallBars({ days, start, end, revision, ariaLabel, height = 340 }) {
  const scheme = useColorScheme();
  const color = seriesColor(scheme, "rainfall");
  const muted = CHROME[scheme].muted;
  const surface = CHROME[scheme].surface;
  const runs = useMemo(() => unverifiedRuns(days), [days]);
  const short = days.length <= 62;

  const traces = useMemo(() => {
    const singles = days.filter((d) => d.kind === "value" && d.value > 0);
    const totals = multiDayBlocks(days);
    const gaps = days.filter((d) => d.kind === "missing" || d.kind === "norecord");
    const top = Math.max(1, ...singles.map((d) => d.value), ...totals.map((t) => t.perDay)) * 1.08;
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
        name: "Multi-day total, average per day",
        // Centred on the days it covers, one day wide per day covered, minus a small gap.
        x: totals.map((t) => new Date((midnight(t.start) + midnight(t.end)) / 2).toISOString()),
        y: totals.map((t) => t.perDay),
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
      customdata: tips.map((t, i) => {
        const d = days[i];
        const drawn = d.kind === "multi"
          ? `<br>Drawn at the average: ${Number((d.total.value / d.total.span).toFixed(1))} mm a day`
          : "";
        return `<b>${t.value}</b><br>${t.date}<br>${t.status}${drawn}`;
      }),
    });
    if (runs.length) out.push(bandLegend(CHROME[scheme].band));
    return { traces: out, top };
  }, [days, color, muted, surface, short, runs, scheme]);

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
      // Pale band behind days BOM hasn't quality-checked yet (utils/quality.js).
      shapes: bandShapes(runs, CHROME[scheme].band),
    }),
    [start, end, short, scheme, traces.top, runs],
  );

  return <PlotlyChart traces={traces.traces} layout={layout} revision={revision} ariaLabel={ariaLabel} height={height} />;
}


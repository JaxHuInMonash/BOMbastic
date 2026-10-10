/**
 * RainfallChart - picks the rainfall view for the range (FR-02, NFR-05).
 *
 *   up to LONG_RANGE_DAYS  daily columns (RainfallBars)
 *   longer                 a calendar per year (RainfallCalendar); selecting a
 *                          month shows its daily columns underneath, because a
 *                          colour scale alone can't show small differences
 *   "Running total"        any range: measured rain added up from the first day
 *                          (RainfallRunningTotal), a separate view rather than a
 *                          second axis on the daily chart
 *
 * Both views and their tooltips read the same classified days
 * (utils/rainfall.js), so a day can't say one thing in the calendar and
 * another in the columns.
 */

import { useMemo, useState } from "react";
import { formatDate } from "../utils/dates";
import { monthBounds, rainfallDays, shiftMonth } from "../utils/rainfall";
import { isLongRange } from "../utils/series";
import RainfallBars from "./RainfallBars";
import RainfallCalendar from "./RainfallCalendar";
import RainfallRunningTotal from "./RainfallRunningTotal";

const MONTH_NAME = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });

const barsLabel = (name, start, end) =>
  `Column chart of daily rainfall at ${name}, ${formatDate(start)} to ${formatDate(end)}, in millimetres. `
  + "Grey crosses mark days with no reading; wide striped columns are totals over several days, drawn at their average per day. "
  + "The exact values are in the table below.";

export default function RainfallChart({ data, view = "daily", onViewChange }) {
  const { station, start, end } = data.query;
  const days = useMemo(() => rainfallDays(data.records, start, end), [data.records, start, end]);
  const key = `${station.station_id}|rainfall|${start}|${end}`;
  // The month picked in the calendar. ChartPanel remounts this per query, so it resets.
  const [month, setMonth] = useState(null);

  const viewSwitch = (
    <div className="segmented chart-view-switch" role="group" aria-label="Rainfall view">
      {[["daily", "Daily"], ["running", "Running total"]].map(([v, label]) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => onViewChange(v)}>{label}</button>
      ))}
    </div>
  );

  if (view === "running") {
    return (
      <>
        {viewSwitch}
        <RainfallRunningTotal
          days={days}
          start={start}
          end={end}
          coverage={data.summary.coverage}
          revision={`${key}|running`}
          ariaLabel={`Line chart of rainfall at ${station.name} added up from ${formatDate(start)} to ${formatDate(end)}, in millimetres. Dashed stretches are multi-day totals; dotted grey stretches are days with no reading. The daily values are in the table below.`}
        />
      </>
    );
  }

  if (!isLongRange(start, end)) {
    return (
      <>
        {viewSwitch}
        <RainfallBars days={days} start={start} end={end} revision={key} ariaLabel={barsLabel(station.name, start, end)} />
      </>
    );
  }

  const firstMonth = start.slice(0, 7);
  const lastMonth = end.slice(0, 7);
  const bounds = month ? monthBounds(`${month}-01`, start, end) : null;
  const monthDays = bounds ? days.slice(days.findIndex((d) => d.date === bounds.start), days.findIndex((d) => d.date === bounds.end) + 1) : null;

  return (
    <>
      {viewSwitch}
      <RainfallCalendar
        days={days}
        start={start}
        end={end}
        selectedMonth={month}
        onSelectMonth={setMonth}
      />
      {month ? (
        <section className="rain-month" aria-label={`Daily rainfall, ${MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`))}`}>
          <div className="rain-month-bar">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= firstMonth} aria-label="Previous month">‹</button>
            <h3>{MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`))}</h3>
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= lastMonth} aria-label="Next month">›</button>
            <button type="button" className="rain-month-close" onClick={() => setMonth(null)}>Close</button>
          </div>
          <RainfallBars
            days={monthDays}
            start={bounds.start}
            end={bounds.end}
            revision={`${key}|${month}`}
            height={260}
            ariaLabel={barsLabel(station.name, bounds.start, bounds.end)}
          />
        </section>
      ) : (
        <p className="chart-note">Select a day or a month name to see that month&apos;s daily rainfall as columns.</p>
      )}
    </>
  );
}

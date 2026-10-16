/**
 * QueryControls - the one filter row above the chart (report §5.2).
 *
 * Variable: only the variables this station actually records (from
 * /api/v1/stations), so the picker never offers an empty chart (FR-07).
 * Date range: presets first (last 1 / 5 / 10 years of the station's own
 * record for that variable), then a custom start/end.
 */

import { useId } from "react";
import { formatDate } from "../utils/dates";
import { PRESETS } from "../utils/ranges";

export default function QueryControls({
  station,
  variables,
  variable,
  onVariableChange,
  range,
  resolved,
  available,
  onRangeChange,
  disabled,
  note,
  children,
}) {
  const id = useId();
  const offered = variables.filter((v) =>
    station.variables.some((sv) => sv.variable_code === v.variable_code),
  );

  return (
    <div className="query-controls" role="group" aria-label="Chart filters">
      {/* Another view can bring its own pickers (e.g. X and Y for a relationship). */}
      {children ?? (
        <div className="control">
          <label htmlFor={`${id}-variable`}>Variable</label>
          <select
            id={`${id}-variable`}
            value={variable}
            onChange={(e) => onVariableChange(e.target.value)}
            disabled={disabled}
          >
            {offered.map((v) => (
              <option key={v.variable_code} value={v.variable_code}>
                {v.label} ({v.unit})
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset className="control">
        <legend>Period</legend>
        <div className="segmented">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={range.preset === p.key}
              onClick={() => onRangeChange({ preset: p.key })}
              disabled={disabled}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={range.preset === "custom"}
            onClick={() => onRangeChange({ preset: "custom", start: resolved.start, end: resolved.end })}
            disabled={disabled}
          >
            Custom
          </button>
        </div>
      </fieldset>

      {range.preset === "custom" && (
        <div className="control custom-range">
          <label htmlFor={`${id}-start`}>From</label>
          <input
            id={`${id}-start`}
            type="date"
            value={range.start ?? ""}
            min={available.first_date}
            max={range.end ?? available.last_date}
            onChange={(e) => e.target.value && onRangeChange({ ...range, start: e.target.value })}
          />
          <label htmlFor={`${id}-end`}>to</label>
          <input
            id={`${id}-end`}
            type="date"
            value={range.end ?? ""}
            min={range.start ?? available.first_date}
            max={available.last_date}
            onChange={(e) => e.target.value && onRangeChange({ ...range, end: e.target.value })}
          />
        </div>
      )}

      <p className="control-note">
        {note ?? (available.first_date
          ? `Recorded ${formatDate(available.first_date)} – ${formatDate(available.last_date)}`
          : "Not recorded at this station")}
      </p>
    </div>
  );
}

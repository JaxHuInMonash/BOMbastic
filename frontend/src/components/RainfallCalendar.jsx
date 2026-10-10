/**
 * RainfallCalendar - rainfall over several years as one calendar grid per year,
 * one square per day (FR-02, NFR-05). Used for ranges too long for daily columns.
 *
 *   very pale       0 mm (a dry day is a reading, not a gap)
 *   blue, darker    more rain, on fixed mm classes so every year is comparable
 *   grey, hatched   no reading, or no record at all
 *   pale with dot   part of a multi-day total (the total is in the tooltip)
 *
 * Every square has a tooltip on hover and on keyboard focus. Clicking a square
 * or a month name, or pressing Enter on a square, selects that month; the
 * month's daily columns then appear underneath (RainfallChart). Keyboard: Tab
 * into the calendar, arrow keys move by day (up/down) and week (left/right).
 *
 * Plain SVG rather than a Plotly heatmap: it needs hatching, per-year grids and
 * keyboard focus, which a heatmap trace doesn't offer. Colours are CSS classes
 * (index.css), so light and dark mode follow the rest of the page.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { binOf, calendarYears, describeDay, RAIN_BINS } from "../utils/rainfall";

const CELL = 12;
const GAP = 2;
const PITCH = CELL + GAP;
const LEFT = 30; // weekday labels
const TOP = 28; // year label, then month labels
const WIDTH = LEFT + 54 * PITCH;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = [["Mon", 0], ["Wed", 2], ["Fri", 4]];

function cellClass(day) {
  if (day.kind === "value") return `rain-cell rain-b${binOf(day.value)}`;
  if (day.kind === "multi") return "rain-cell rain-multi";
  return "rain-cell rain-missing";
}

/**
 * One year's grid. Memoised so moving the tooltip doesn't redraw thousands of
 * squares; it redraws only when the selected month or the keyboard stop
 * (the one square with tabIndex 0) is in this year.
 */
const YearGrid = memo(function YearGrid({ year, cells, months, days, tips, selectedMonth, focusIndex, handlers }) {
  return (
    <section className="rain-year" aria-label={`Rainfall ${year}`}>
      <svg viewBox={`0 0 ${WIDTH} ${TOP + 7 * PITCH}`} className="rain-year-grid" {...handlers}>
        <text className="rain-year-label" x="0" y="10">{year}</text>
        {WEEKDAYS.map(([label, row]) => (
          <text key={label} className="rain-axis-label" x="0" y={TOP + row * PITCH + CELL - 2}>{label}</text>
        ))}
        {months.map(({ month, col }) => (
          <text
            key={month}
            data-month={month}
            className={`rain-month-label${month === selectedMonth ? " is-selected" : ""}`}
            x={LEFT + col * PITCH}
            y={TOP - 4}
          >
            {MONTHS[Number(month.slice(5)) - 1]}
          </text>
        ))}
        {cells.map(({ index, date, col, row }) => {
          const day = days[index];
          const x = LEFT + col * PITCH;
          const y = TOP + row * PITCH;
          const t = tips[index];
          return (
            <g key={date}>
              <rect
                data-index={index}
                className={`${cellClass(day)}${selectedMonth && date.startsWith(selectedMonth) ? " is-selected" : ""}`}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx="2"
                tabIndex={index === focusIndex ? 0 : -1}
                aria-label={`${t.date}: ${t.value}. ${t.status}`}
              />
              {day.kind === "multi" && (
                <circle className="rain-multi-dot" cx={x + CELL / 2} cy={y + CELL / 2} r="2" pointerEvents="none" />
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
});

function Tooltip({ tip }) {
  if (!tip) return null;
  const { text, x, y, below } = tip;
  return (
    <div
      className="chart-tooltip"
      role="presentation"
      style={{ left: x, top: y, transform: below ? "translate(-50%, 8px)" : "translate(-50%, calc(-100% - 8px))" }}
    >
      <strong>{text.value}</strong>
      <span>{text.date}</span>
      <span className="chart-tooltip-status">{text.status}</span>
    </div>
  );
}

export default function RainfallCalendar({ days, start, end, selectedMonth, onSelectMonth }) {
  const years = useMemo(() => calendarYears(start, end), [start, end]);
  const tips = useMemo(() => days.map(describeDay), [days]);
  const wrapRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [focusIndex, setFocusIndex] = useState(days.length - 1);
  const [keyboardMoved, setKeyboardMoved] = useState(false);

  // Move real DOM focus only after an arrow key, never on first render.
  useEffect(() => {
    if (!keyboardMoved || !wrapRef.current) return;
    wrapRef.current.querySelector(`[data-index="${focusIndex}"]`)?.focus();
  }, [focusIndex, keyboardMoved]);

  const handlers = useMemo(() => {
    const indexOf = (el) => {
      const i = Number(el?.closest?.("[data-index]")?.dataset.index);
      return Number.isNaN(i) ? null : i;
    };
    const show = (el) => {
      const index = indexOf(el);
      if (index === null || !wrapRef.current) return;
      const box = el.getBoundingClientRect();
      const frame = wrapRef.current.getBoundingClientRect();
      const y = box.top - frame.top;
      // Keep the tooltip inside the calendar: clamp its centre away from the edges.
      const x = Math.min(frame.width - 130, Math.max(130, box.left - frame.left + box.width / 2));
      setTip({ text: tips[index], x, y: y < 70 ? y + box.height : y, below: y < 70 });
    };
    const select = (el) => {
      const month = el?.dataset?.month;
      if (month) return onSelectMonth(month);
      const index = indexOf(el);
      if (index !== null) onSelectMonth(days[index].date.slice(0, 7));
      return undefined;
    };
    return {
      onPointerOver: (e) => show(e.target),
      onClick: (e) => select(e.target),
      onFocus: (e) => {
        const index = indexOf(e.target);
        if (index !== null) setFocusIndex(index);
        show(e.target);
      },
      onBlur: () => setTip(null),
      onKeyDown: (e) => {
        const move = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
        if (move !== undefined) {
          e.preventDefault();
          setKeyboardMoved(true);
          setFocusIndex((i) => Math.min(days.length - 1, Math.max(0, i + move)));
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select(e.target);
        } else if (e.key === "Escape") {
          setTip(null);
        }
      },
    };
  }, [days, tips, onSelectMonth]);

  const hide = useCallback(() => setTip(null), []);

  return (
    <div className="rain-calendar" ref={wrapRef} onPointerLeave={hide}>
      <ul className="rain-legend" aria-label="Colour key">
        {RAIN_BINS.map((b, i) => (
          <li key={b.label}>
            <svg width="12" height="12" aria-hidden="true"><rect className={`rain-b${i}`} width="12" height="12" rx="2" /></svg>
            {b.label}
          </li>
        ))}
        <li>
          <svg width="12" height="12" aria-hidden="true"><rect className="rain-missing" width="12" height="12" rx="2" /></svg>
          No reading
        </li>
        <li>
          <svg width="12" height="12" aria-hidden="true">
            <rect className="rain-multi" width="12" height="12" rx="2" />
            <circle className="rain-multi-dot" cx="6" cy="6" r="2" />
          </svg>
          Part of a multi-day total
        </li>
      </ul>

      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
        <defs>
          <pattern id="rain-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect className="rain-hatch-bg" width="4" height="4" />
            <line className="rain-hatch-line" x1="0" y1="0" x2="0" y2="4" />
          </pattern>
        </defs>
      </svg>

      {years.map(({ year, cells, months }) => {
        const first = cells[0]?.index ?? 0;
        const last = cells[cells.length - 1]?.index ?? -1;
        const holdsFocus = focusIndex >= first && focusIndex <= last;
        const holdsMonth = Boolean(selectedMonth?.startsWith(`${year}-`));
        return (
          <YearGrid
            key={year}
            year={year}
            cells={cells}
            months={months}
            days={days}
            tips={tips}
            // Only this year's own state reaches it, so other years skip redrawing.
            selectedMonth={holdsMonth ? selectedMonth : null}
            focusIndex={holdsFocus ? focusIndex : -1}
            handlers={handlers}
          />
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
}

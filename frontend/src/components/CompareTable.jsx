/**
 * CompareTable - both stations' daily values side by side, the exact numbers
 * behind the comparison chart (DR-05). Same records as the chart, never a sample.
 */

import { useId, useState } from "react";
import { differences } from "../utils/compare";
import { formatDate } from "../utils/dates";

const PAGE_SIZE = 50;

const QUALITY = { observed: "", unverified: " (not yet checked)", interpolated: " (interpolated)" };

function cell(day) {
  if (day.kind === "value") return `${day.value}${QUALITY[day.quality] ?? ""}`;
  if (day.kind === "multi") {
    return day.date === day.total.end ? `${day.total.value} over ${day.total.span} days` : `(in ${day.total.span}-day value)`;
  }
  return day.kind === "missing" ? "No reading" : "No record";
}

export default function CompareTable({ pair, daysA, daysB }) {
  const id = useId();
  const { a, b } = pair;
  const { label, unit } = a.query.variable;
  const temperature = a.query.variable.semantic_type !== "accumulation";
  const diff = temperature ? differences(daysA, daysB).values : null;
  const pages = Math.max(1, Math.ceil(daysA.length / PAGE_SIZE));
  const key = `${a.query.station.station_id}|${b.query.station.station_id}|${a.query.variable.variable_code}|${a.query.start}|${a.query.end}`;
  const [view, setView] = useState({ key, page: 0 });
  // A new comparison starts back on its first page.
  const page = view.key === key ? Math.min(view.page, pages - 1) : 0;
  const goTo = (p) => setView({ key, page: p });
  const from = page * PAGE_SIZE;
  const rows = daysA.slice(from, from + PAGE_SIZE);

  return (
    <section className="data-table" aria-labelledby={`${id}-caption`}>
      <div className="table-scroll">
        <table>
          <caption id={`${id}-caption`}>
            {label} ({unit}), A {a.query.station.name} and B {b.query.station.name}, {formatDate(a.query.start)} – {formatDate(a.query.end)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="num">A · {a.query.station.name}</th>
              <th scope="col" className="num">B · {b.query.station.name}</th>
              {temperature && <th scope="col" className="num">A − B</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((dayA, i) => (
              <tr key={dayA.date}>
                <td>{formatDate(dayA.date)}</td>
                <td className="num">{cell(dayA)}</td>
                <td className="num">{cell(daysB[from + i])}</td>
                {temperature && <td className="num">{diff[from + i] === null ? "—" : diff[from + i]}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="Table pages">
          <button type="button" onClick={() => goTo(page - 1)} disabled={page === 0}>Previous</button>
          <span>Page {page + 1} of {pages} · {daysA.length.toLocaleString()} days</span>
          <button type="button" onClick={() => goTo(page + 1)} disabled={page >= pages - 1}>Next</button>
        </nav>
      )}
    </section>
  );
}

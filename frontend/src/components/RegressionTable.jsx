/**
 * RegressionTable - the paired days behind the scatterplot, with the fitted
 * value and residual for each (DR-05). Same points as the chart, never a sample.
 */

import { useId, useState } from "react";
import { formatDate } from "../utils/dates";

const PAGE_SIZE = 50;
const STATUS = { observed: "", unverified: " (not yet checked)", interpolated: " (interpolated)" };

export default function RegressionTable({ data }) {
  const id = useId();
  const { x, y, station, start, end, quality_policy: policy } = data.query;
  const points = data.points;
  const pages = Math.max(1, Math.ceil(points.length / PAGE_SIZE));
  const key = `${station.station_id}|${x.variable_code}|${y.variable_code}|${start}|${end}|${policy}`;
  const [view, setView] = useState({ key, page: 0 });
  // A new fit starts back on its first page.
  const page = view.key === key ? Math.min(view.page, pages - 1) : 0;
  const goTo = (p) => setView({ key, page: p });
  const rows = points.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <section className="data-table" aria-labelledby={`${id}-caption`}>
      <div className="table-scroll">
        <table>
          <caption id={`${id}-caption`}>
            Paired days at {station.name}, {formatDate(start)} – {formatDate(end)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="num">X: {x.label} ({x.unit})</th>
              <th scope="col" className="num">Y: {y.label} ({y.unit})</th>
              <th scope="col" className="num">Fitted Y</th>
              <th scope="col" className="num">Residual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.date}>
                <td>{formatDate(p.date)}</td>
                <td className="num">{p.x}{STATUS[p.x_quality]}</td>
                <td className="num">{p.y}{STATUS[p.y_quality]}</td>
                <td className="num">{p.fitted.toFixed(2)}</td>
                <td className="num">{p.residual.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="Table pages">
          <button type="button" onClick={() => goTo(page - 1)} disabled={page === 0}>Previous</button>
          <span>Page {page + 1} of {pages} · {points.length.toLocaleString()} paired days</span>
          <button type="button" onClick={() => goTo(page + 1)} disabled={page >= pages - 1}>Next</button>
        </nav>
      )}
    </section>
  );
}

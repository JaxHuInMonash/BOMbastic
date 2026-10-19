
/**
 * RegressionTable - monthly observations and fitted values
 * for Seasonal + Trend Regression.
 */

import { useId, useState } from "react";
import { formatDate } from "../utils/dates";

const PAGE_SIZE = 50;

function formatValue(value) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toFixed(2);
}

export default function RegressionTable({ data }) {
  const id = useId();

  const {
    variable,
    station,
    start,
    end,
    quality_policy: policy,
  } = data.query;

  const points = data.points ?? [];

  const pages = Math.max(
    1,
    Math.ceil(points.length / PAGE_SIZE)
  );

  const key = `${station.station_id}|${variable.variable_code}|${start}|${end}|${policy}`;

  const [view, setView] = useState({
    key,
    page: 0,
  });

  // Return to page one when the regression changes.
  const page =
    view.key === key
      ? Math.min(view.page, pages - 1)
      : 0;

  const goTo = (p) =>
    setView({ key, page: p });

  const rows = points.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE
  );

  return (
    <section
      className="data-table"
      aria-labelledby={`${id}-caption`}
    >
      <div className="table-scroll">
        <table>
          <caption id={`${id}-caption`}>
            Monthly {variable.label.toLowerCase()} at{" "}
            {station.name},{" "}
            {formatDate(start)} – {formatDate(end)}
          </caption>

          <thead>
            <tr>
              <th scope="col">Month</th>

              <th scope="col" className="num">
                Observed ({variable.unit})
              </th>

              <th scope="col" className="num">
                Fitted ({variable.unit})
              </th>

              <th scope="col" className="num">
                Residual ({variable.unit})
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((p) => (
              <tr key={p.date}>
                <td>{formatDate(p.date)}</td>

                <td className="num">
                  {formatValue(p.observed)}
                </td>

                <td className="num">
                  {formatValue(p.fitted)}
                </td>

                <td className="num">
                  {formatValue(p.residual)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav
          className="pager"
          aria-label="Table pages"
        >
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page === 0}
          >
            Previous
          </button>

          <span>
            Page {page + 1} of {pages}
            {" · "}
            {points.length.toLocaleString()} months
          </span>

          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={page >= pages - 1}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

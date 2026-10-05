/**
 * DataTable - the exact values behind the chart (report §5.2; DR-05: every
 * chart has a table equivalent). Same records as the chart, never a sample.
 */

import { useId, useState } from "react";
import { csvFilename, toCsv } from "../utils/analysis";
import { formatDate } from "../utils/dates";

const PAGE_SIZE = 50;

const QUALITY_LABEL = {
  observed: "Quality-checked",
  unverified: "Not yet checked",
  interpolated: "Interpolated",
  missing: "No reading",
};

/** Download exactly the records on screen (FR-08). */
function downloadCsv(data) {
  const url = URL.createObjectURL(new Blob([toCsv(data)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = csvFilename(data);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function DataTable({ data }) {
  const id = useId();
  const records = data?.records ?? [];
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const queryKey = data ? `${data.query.station.station_id}|${data.query.variable.variable_code}|${data.query.start}|${data.query.end}` : "";
  const [view, setView] = useState({ key: queryKey, page: 0 });
  // A new query starts back on its first page.
  const page = view.key === queryKey ? Math.min(view.page, pages - 1) : 0;
  const goTo = (p) => setView({ key: queryKey, page: p });

  if (!data || records.length === 0) return null;
  const { unit, label } = data.query.variable;
  const rows = records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <section className="data-table" aria-labelledby={`${id}-caption`}>
      <div className="table-toolbar">
        <button type="button" onClick={() => downloadCsv(data)}>Download CSV</button>
        <span className="control-note">{records.length.toLocaleString()} days, with units, quality and days covered</span>
      </div>
      <div className="table-scroll">
        <table>
          <caption id={`${id}-caption`}>
            {label} at {data.query.station.name}, {formatDate(data.query.start)} – {formatDate(data.query.end)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="num">{label} ({unit})</th>
              <th scope="col">Quality</th>
              <th scope="col" className="num">Days covered</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td>{formatDate(r.date)}</td>
                <td className="num">{r.value === null ? "—" : r.value}</td>
                <td>{QUALITY_LABEL[r.quality_state]}</td>
                <td className="num">{r.value === null ? "" : (r.accumulation_days ?? 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="Table pages">
          <button type="button" onClick={() => goTo(page - 1)} disabled={page === 0}>
            Previous
          </button>
          <span>
            Page {page + 1} of {pages} · {records.length.toLocaleString()} days
          </span>
          <button type="button" onClick={() => goTo(page + 1)} disabled={page >= pages - 1}>
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

/**
 * ExportLink - "Download CSV" for the query on screen (FR-08, DR-01).
 *
 * The file comes from GET /api/v1/export.csv for exactly the same station(s),
 * variable and dates as the table, so it holds the same records. Every row has
 * station ID and name, date, variable, value, unit, quality flag, days covered
 * and the source product and ingestion run (column list in backend/api_v1.py).
 * A missing day is an empty value, never 0.
 */

import { api } from "../api/client";

export default function ExportLink({ query, note }) {
  return (
    <div className="table-toolbar">
      <a className="button" href={api.exportUrl(query)} download>
        Download CSV
      </a>
      <span className="control-note">{note}</span>
    </div>
  );
}

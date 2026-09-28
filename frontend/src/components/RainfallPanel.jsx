/**
 * RainfallPanel - NFR-05 (Data quality handling), paired with FR-03
 *
 * Shows a selected station's rainfall history with missing, accumulated
 * and unverified readings clearly marked, instead of quietly presenting
 * them as normal daily values. Backs onto GET /api/rainfall/:station_id.
 */

import { useEffect, useState } from "react";

const API_BASE = import.meta.env?.VITE_API_BASE ?? "http://localhost:8000";

const FLAG_META = {
  ok: { label: "Recorded", color: "#2e7d32", symbol: "" },
  missing: { label: "No reading", color: "#9e9e9e", symbol: "—" },
  accumulated: {
    label: "Accumulated total",
    color: "#ef6c00",
    symbol: "\u2211", // Σ
  },
  unverified: { label: "Unverified reading", color: "#c62828", symbol: "!" },
};

export default function RainfallPanel({ stationId, startYear, endYear }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!stationId) return;

    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (startYear) params.set("start_year", startYear);
    if (endYear) params.set("end_year", endYear);

    fetch(`${API_BASE}/api/rainfall/${stationId}?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`No rainfall data for this station (${res.status})`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [stationId, startYear, endYear]);

  if (!stationId) return null;
  if (loading) return <p>Loading rainfall data...</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!data) return null;

  const { summary, records } = data;
  // most recent 14 records with any flag worth explaining, so the demo
  // table stays short but still shows every flag type if present
  const notable = records.filter((r) => r.flag !== "ok").slice(-14);

  return (
    <div>
      <h4>Data quality summary</h4>
      <ul style={{ listStyle: "none", padding: 0 }}>
        <li>Total days in range: {summary.total_days}</li>
        <li style={{ color: FLAG_META.missing.color }}>
          {summary.pct_missing}% no reading recorded
        </li>
        <li style={{ color: FLAG_META.accumulated.color }}>
          {summary.pct_accumulated}% accumulated over multiple days (not a single-day value)
        </li>
        <li style={{ color: FLAG_META.unverified.color }}>
          {summary.pct_unverified}% not yet quality-verified by BOM
        </li>
      </ul>

      {notable.length > 0 && (
        <>
          <h4>Recent flagged readings</h4>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Rainfall (mm)</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {notable.map((r) => {
                const meta = FLAG_META[r.flag];
                return (
                  <tr key={r.date} style={{ color: meta.color }}>
                    <td>{r.date}</td>
                    <td>
                      {meta.symbol} {r.rainfall_mm ?? "—"}
                      {r.flag === "accumulated" && ` (over ${r.period_days} days)`}
                    </td>
                    <td>{meta.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

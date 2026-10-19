/**
 * RainfallPanel - NFR-05 (Data quality handling), paired with FR-03
 *
 * Shows a selected station's rainfall history with missing, accumulated
 * and unverified readings clearly marked, instead of quietly presenting
 * them as normal daily values. Backs onto GET /api/rainfall/:station_id.
 *
 * Fetching: the request URL is worked out during render, and the effect only
 * fetches it. Each answer is stored with the URL it answers, so "loading" is
 * simply "the stored answer is for a different URL" and never has to be set
 * inside the effect (react-hooks/set-state-in-effect). Switching station
 * cancels the previous request, so a slow answer for the old station can't
 * overwrite the new one.
 */

import { useEffect, useState } from "react";

const API_BASE = import.meta.env?.VITE_API_BASE ?? "http://localhost:8001";

const FLAG_META = {
  ok: { label: "Recorded", color: "#2e7d32", symbol: "" },
  missing: { label: "No reading", color: "#9e9e9e", symbol: "—" },
  accumulated: {
    label: "Accumulated total",
    color: "#ef6c00",
    symbol: "∑", // Σ
  },
  unverified: { label: "Unverified reading", color: "#c62828", symbol: "!" },
};

function rainfallUrl(stationId, startYear, endYear) {
  if (!stationId) return null;
  const params = new URLSearchParams();
  if (startYear) params.set("start_year", startYear);
  if (endYear) params.set("end_year", endYear);
  return `${API_BASE}/api/rainfall/${stationId}?${params}`;
}

export default function RainfallPanel({ stationId, startYear, endYear }) {
  const url = rainfallUrl(stationId, startYear, endYear);
  const [result, setResult] = useState({ url: null, data: null, error: null });

  useEffect(() => {
    if (!url) return undefined;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`No rainfall data for this station (${res.status})`);
        return res.json();
      })
      .then((data) => setResult({ url, data, error: null }))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setResult({ url, data: null, error: err.message });
      });
    return () => controller.abort();
  }, [url]);

  if (!url) return null;
  if (result.url !== url) return <p>Loading rainfall data...</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  const { data } = result;
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

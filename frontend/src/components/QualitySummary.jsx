/**
 * QualitySummary - coverage and data-quality counts for the active query
 * (report §5.2, NFR-05). Every count is a number with a word, never colour alone,
 * and each key is drawn the way the chart draws that state.
 */

const STATES = [
  { key: "observed", label: "Quality-checked", hint: "BOM has checked these readings" },
  { key: "unverified", label: "Not yet checked", hint: "Recorded, but BOM has not finished quality control; shown on the chart as a pale band" },
  { key: "missing", label: "No reading", hint: "BOM has the day but no measurement for it; shown on the chart as a grey ×" },
  { key: "no_record", label: "Outside the record", hint: "Days before the station started or after it stopped" },
];

function percent(n) {
  return `${Math.round(n * 100)}%`;
}

export default function QualitySummary({ data }) {
  if (!data?.summary) return null;
  const { summary, quality_counts: counts, query } = data;
  const unit = query.variable.unit;
  const total = summary.aggregate === "total";

  return (
    <section className="quality-summary" aria-label="Data quality for this period">
      <dl className="stat-row">
        <div className="stat">
          <dt>Coverage</dt>
          <dd>{percent(summary.coverage)}</dd>
          <p className="stat-note">
            {summary.days_covered.toLocaleString()} of {summary.days_in_range.toLocaleString()} days
          </p>
        </div>
        <div className="stat">
          <dt>{total ? "Total" : "Mean"}</dt>
          <dd>
            {summary.aggregate_value === null ? "—" : `${summary.aggregate_value.toLocaleString()} ${unit}`}
          </dd>
          {summary.aggregate_withheld_reason && (
            <p className="stat-note">{summary.aggregate_withheld_reason}</p>
          )}
        </div>
        <div className="stat">
          <dt>Highest single day</dt>
          <dd>{summary.max_single_day === null ? "—" : `${summary.max_single_day} ${unit}`}</dd>
        </div>
        <div className="stat">
          <dt>Lowest single day</dt>
          <dd>{summary.min_single_day === null ? "—" : `${summary.min_single_day} ${unit}`}</dd>
        </div>
      </dl>

      <ul className="quality-counts">
        {STATES.map((s) =>
          counts[s.key] > 0 ? (
            <li key={s.key} title={s.hint}>
              <span className={`quality-key quality-key--${s.key}`} aria-hidden="true" />
              <strong>{counts[s.key].toLocaleString()}</strong> {s.label.toLowerCase()}
            </li>
          ) : null,
        )}
        {summary.multi_day_values > 0 && (
          <li title="A total measured over several days, reported against the last of them">
            <span className="quality-key quality-key--multi" aria-hidden="true" />
            <strong>{summary.multi_day_values.toLocaleString()}</strong> multi-day totals
          </li>
        )}
      </ul>
    </section>
  );
}

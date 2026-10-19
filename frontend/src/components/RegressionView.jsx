
/**
 * Seasonal + Trend Regression
 * Analyses one weather variable over time at one station.
 */

import { useId, useState } from "react";
import { useRegression } from "../api/hooks";
import { resolveRange } from "../utils/ranges";
import { stationVariables, sig } from "../utils/regression";
import QueryControls from "./QueryControls";
import RegressionChart from "./RegressionChart";
import RegressionTable from "./RegressionTable";

const ERROR_TITLE = {
  unreachable: "The API isn't responding",
  unavailable: "The database isn't available",
  invalid: "That request isn't valid",
  not_found: "Not found",
  server: "Something went wrong",
};

function answers(data, q) {
  return Boolean(data?.query)
    && data.query.station.station_id === q.stationId
    && data.query.variable.variable_code === q.variable
    && data.query.start === q.start
    && data.query.end === q.end
    && data.query.quality_policy === q.qualityPolicy;
}

export default function RegressionView({
  station,
  stations,
  variables,
  onSelectStation,
  range,
  onRangeChange,
}) {
  const id = useId();

  const offered = stationVariables(variables, station);
  const codes = offered.map((v) => v.variable_code);

  const [chosen, setChosen] = useState("tmax");
  const [checkedOnly, setCheckedOnly] = useState(false);

  const selectedVariable = codes.includes(chosen)
    ? chosen
    : codes[0];

  const selectedInfo = offered.find(
    (v) => v.variable_code === selectedVariable
  );

  const availability = station.variables.find(
    (v) => v.variable_code === selectedVariable
  );

  const resolved = availability
    ? resolveRange(range, availability)
    : {};

  const query = {
    stationId: station.station_id,
    variable: selectedVariable,
    start: resolved.start,
    end: resolved.end,
    qualityPolicy: checkedOnly ? "checked" : "all",
  };

  const result = useRegression(
    selectedVariable && availability ? query : {}
  );

  const data = answers(result.data, query)
    ? result.data
    : null;

  if (!selectedVariable || !availability) {
    return (
      <div className="chart-frame chart-message" role="status">
        <p className="chart-message-title">
          No weather observations available
        </p>
        <p>
          {station.name} has no available weather variable
          for seasonal regression.
        </p>
      </div>
    );
  }

  return (
    <>
      <QueryControls
        station={station}
        variables={variables}
        variable={selectedVariable}
        range={range}
        resolved={resolved}
        available={availability}
        onRangeChange={onRangeChange}
        note="Seasonal regression requires at least 24 complete months of observations."
      >
        <div className="control">
          <label htmlFor={`${id}-variable`}>
            Weather variable
          </label>

          <select
            id={`${id}-variable`}
            value={selectedVariable}
            onChange={(e) => setChosen(e.target.value)}
          >
            {offered.map((v) => (
              <option
                key={v.variable_code}
                value={v.variable_code}
              >
                {v.label} ({v.unit})
              </option>
            ))}
          </select>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={checkedOnly}
            onChange={(e) =>
              setCheckedOnly(e.target.checked)
            }
          />
          Only quality-checked readings
        </label>
      </QueryControls>

      {result.error && !result.loading ? (
        <div
          className="chart-frame chart-message"
          role="alert"
        >
          <p className="chart-message-title">
            {ERROR_TITLE[result.error.kind] ?? ERROR_TITLE.server}
          </p>
          <p>{result.error.message}</p>
          <button type="button" onClick={result.retry}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <div
          className="chart-frame chart-message"
          aria-busy="true"
        >
          <p>Fitting seasonal regression…</p>
        </div>
      ) : data.status !== "ok" ? (
        <div
          className="chart-frame chart-message"
          role="status"
        >
          <p className="chart-message-title">
            {data.status === "insufficient"
              ? "Insufficient monthly data"
              : "No data"}
          </p>
          <p>{data.message}</p>
          <p className="control-note">
            Months available: {data.months_used}
          </p>
        </div>
      ) : (
        <>
          <figure className="chart-frame">
            <figcaption className="chart-title">
              {selectedInfo?.label} — Seasonal + Trend
              {" · "}
              {station.name}
            </figcaption>

            <RegressionChart data={data} />
          </figure>

          <section
            className="quality-summary"
            aria-label="Seasonal regression results"
          >
            <p className="regression-equation">
              Seasonal + Trend Regression
            </p>

            <p className="control-note">
              y = β₀ + β₁t + β₂sin(2πt/12)
              + β₃cos(2πt/12)
            </p>

            <dl className="stat-row">
              <div className="stat">
                <dt>Trend per month</dt>
                <dd>
                  {sig(data.model.trend_per_month)}
                  {" "}
                  {selectedInfo?.unit}
                </dd>
              </div>

              <div className="stat">
                <dt>Intercept</dt>
                <dd>
                  {sig(data.model.intercept)}
                  {" "}
                  {selectedInfo?.unit}
                </dd>
              </div>

              <div className="stat">
                <dt>R²</dt>
                <dd>
                  {data.model.r_squared === null
                    ? "—"
                    : data.model.r_squared.toFixed(3)}
                </dd>
              </div>

              <div className="stat">
                <dt>Adjusted R²</dt>
                <dd>
                  {data.model.adjusted_r_squared === null
                    ? "—"
                    : data.model.adjusted_r_squared.toFixed(3)}
                </dd>
              </div>

              <div className="stat">
                <dt>RMSE</dt>
                <dd>
                  {sig(data.model.rmse)}
                  {" "}
                  {selectedInfo?.unit}
                </dd>
              </div>

              <div className="stat">
                <dt>Months used</dt>
                <dd>{data.model.n}</dd>
              </div>
            </dl>

            <p className="control-note">
              {data.warnings.join(" ")}
            </p>
          </section>

          <RegressionTable data={data} />
        </>
      )}

      <p className="caveat" role="note">
        This model describes historical seasonal patterns
        and long-term trends at this station.
        It is not a forecast and does not establish causation.
      </p>
    </>
  );
}

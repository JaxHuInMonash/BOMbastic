/**
 * Dashboard - the explore-one-place journey (report §2.3, journey 1; FR-01, FR-03, FR-07).
 *
 * Owns the query state and hands it down: map and station list on the left,
 * filters, chart, quality summary and table on the right. Every view below the
 * filter row reads the same response, so the numbers always agree.
 *
 * Variable rule: the variable you chose stays chosen when you change station.
 * If the new station doesn't record it, the chart falls back to rainfall (every
 * station has it) without forgetting your choice, so the next station that does
 * record it shows it again.
 *
 * Companion rule: when the variable is a temperature and the station records
 * the other one too, that one is fetched for the same dates and drawn lighter
 * on the same chart. The quality summary and table stay on the chosen variable.
 */

import { useId, useState } from "react";
import { useObservations, useStations, useVariables } from "../api/hooks";
import { resolveRange } from "../utils/ranges";
import { companionOf } from "../utils/series";
import ChartPanel from "./ChartPanel";
import DataTable from "./DataTable";
import QualitySummary from "./QualitySummary";
import QueryControls from "./QueryControls";
import StationMap from "./StationMap";

function effectiveVariable(station, chosen) {
  const has = (code) => station.variables.some((v) => v.variable_code === code);
  if (has(chosen)) return chosen;
  if (has("rainfall")) return "rainfall";
  return station.variables[0]?.variable_code;
}

export default function Dashboard() {
  const listId = useId();
  const stations = useStations();
  const variables = useVariables();

  const [stationId, setStationId] = useState(null);
  const [chosenVariable, setChosenVariable] = useState("rainfall");
  const [range, setRange] = useState({ preset: "1y" });

  const stationList = stations.data?.stations ?? [];
  const station = stationList.find((s) => s.station_id === stationId) ?? null;
  const variable = station ? effectiveVariable(station, chosenVariable) : null;
  const available = station?.variables.find((v) => v.variable_code === variable) ?? {};
  const resolved = station && available.last_date ? resolveRange(range, available) : {};

  const observations = useObservations({ stationId, variable, start: resolved.start, end: resolved.end });
  // The other temperature, same station and dates, drawn lighter beside the chosen one.
  const companionCode = station ? companionOf(variable, station) : null;
  const companion = useObservations({
    stationId: companionCode ? stationId : null,
    variable: companionCode,
    start: resolved.start,
    end: resolved.end,
  });

  return (
    <div className="dashboard">
      <section className="map-pane" aria-label="Station map">
        {stations.error ? (
          <div className="chart-message" role="alert">
            <p className="chart-message-title">Couldn't load stations</p>
            <p>{stations.error.message}</p>
            <button type="button" onClick={stations.retry}>Try again</button>
          </div>
        ) : (
          <StationMap stations={stationList} selectedId={stationId} onSelect={setStationId} />
        )}
      </section>

      <section className="detail-pane" aria-label="Selected station">
        <header className="detail-header">
          <h1>{station ? station.name : "Choose a station"}</h1>
          <div className="control station-picker">
            <label htmlFor={listId}>{station ? "Station" : "Pick on the map, or from the list"}</label>
            <select
              id={listId}
              value={stationId ?? ""}
              onChange={(e) => setStationId(e.target.value || null)}
              disabled={!stationList.length}
            >
              <option value="">
                {stations.loading ? "Loading stations…" : `${stationList.length} stations with data`}
              </option>
              {stationList.map((s) => (
                <option key={s.station_id} value={s.station_id}>
                  {s.name} ({s.state}) · {s.station_id}
                </option>
              ))}
            </select>
          </div>
        </header>

        {station && variables.data && (
          <>
            <QueryControls
              station={station}
              variables={variables.data}
              variable={variable}
              onVariableChange={setChosenVariable}
              range={range}
              resolved={resolved}
              available={available}
              onRangeChange={setRange}
            />
            <ChartPanel result={observations} companion={companionCode ? companion : null} />
            <QualitySummary data={observations.data} />
            <DataTable data={observations.data} />
          </>
        )}

        {!station && !stations.error && (
          <p className="empty-hint">
            Every marker is a station with data in the database. Select one to see its chart,
            data quality and the exact daily values.
          </p>
        )}
      </section>
    </div>
  );
}

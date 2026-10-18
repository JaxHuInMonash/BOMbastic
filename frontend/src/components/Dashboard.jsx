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
 * Compare (FR-04): a second tab keeps the current station as A and sets B
 * from the next map click or the B list. Variable and period are shared with
 * Explore, so switching tabs keeps the same question.
 *
 * Relationship (FR-05): a third tab fits a line between two variables at the
 * current station. It is one-station only, as the report's journey requires.
 * While it is open the station list holds only stations where two variables
 * could give 20 paired days, the other pins fade, and clicking a faded pin
 * only opens its popup.
 *
 * Companion rule: when the variable is a temperature and the station records
 * the other one too, that one is fetched for the same dates and drawn lighter
 * on the same chart. The quality summary and table stay on the chosen variable.
 */

import { useId, useState } from "react";
import { useObservations, useStations, useVariables } from "../api/hooks";
import { resolveRange } from "../utils/ranges";
import { canRelate } from "../utils/regression";
import { companionOf } from "../utils/series";
import ChartPanel from "./ChartPanel";
import CompareView from "./CompareView";
import DataTable from "./DataTable";
import QualitySummary from "./QualitySummary";
import QueryControls from "./QueryControls";
import RegressionView from "./RegressionView";
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
  const [mode, setMode] = useState("explore");
  const [compareId, setCompareId] = useState(null);
  const listBId = useId();

  const stationList = stations.data?.stations ?? [];
  const station = stationList.find((s) => s.station_id === stationId) ?? null;
  const comparing = mode === "compare" && Boolean(station);
  const relating = mode === "relationship" && Boolean(station);
  const pickable = relating ? stationList.filter(canRelate) : stationList;
  const stationB = comparing ? stationList.find((s) => s.station_id === compareId && s.station_id !== stationId) ?? null : null;

  // In Compare the map picks B; clicking A's own pin does nothing. In
  // Relationship a faded pin (no usable pair) only shows its popup.
  const onMapSelect = (id) => {
    if (comparing) {
      if (id !== stationId) setCompareId(id);
    } else if (!relating || pickable.some((s) => s.station_id === id)) {
      setStationId(id);
    }
  };
  const swap = () => {
    setCompareId(stationId);
    setStationId(compareId);
  };
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
          <>
            <StationMap
              stations={stationList}
              selectedId={stationId}
              compareId={stationB?.station_id ?? null}
              comparing={comparing}
              dimmed={relating ? (s) => !canRelate(s) : null}
              onSelect={onMapSelect}
            />
            <aside className="map-guide" aria-live="polite">
              <strong>{station ? "Selected station" : "Explore the map"}</strong>
              <span>
                {station
                  ? `${station.name} · ${station.state}${comparing && stationB ? `  |  B: ${stationB.name} · ${stationB.state}` : ""}`
                  : "Select a marker, or choose a station from the list."}
              </span>
            </aside>
          </>
        )}
      </section>

      <section className="detail-pane" aria-label="Selected station">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">B</span>
          <div>
            <p className="brand-name">BOMbastic</p>
            <p className="brand-tagline">Explore Australian weather data</p>
          </div>
        </div>
        <header className="detail-header">
          <h1>
            {!station ? "Choose a station" : comparing && stationB ? (
              <><span className="key-a">A</span> {station.name} <span className="vs">vs</span> <span className="key-b">B</span> {stationB.name}</>
            ) : station.name}
          </h1>
          <div className="station-pickers">
            <div className="control station-picker">
              <label htmlFor={listId}>{!station ? "Pick on the map, or from the list" : comparing ? "A" : "Station"}</label>
              <select
                id={listId}
                value={relating && !canRelate(station) ? "" : stationId ?? ""}
                onChange={(e) => {
                  // In Relationship the placeholder isn't a way out of the tab.
                  if (e.target.value || !relating) setStationId(e.target.value || null);
                }}
                disabled={!stationList.length}
              >
                <option value="">
                  {stations.loading
                    ? "Loading stations…"
                    : relating
                      ? `${pickable.length} stations with two variables`
                      : `${stationList.length} stations with data`}
                </option>
                {pickable.map((s) => (
                  <option key={s.station_id} value={s.station_id}>
                    {s.name} ({s.state}) · {s.station_id}
                  </option>
                ))}
              </select>
            </div>
            {comparing && (
              <div className="control station-picker">
                <label htmlFor={listBId}>B</label>
                <select id={listBId} value={stationB?.station_id ?? ""} onChange={(e) => setCompareId(e.target.value || null)}>
                  <option value="">Click a pin, or choose…</option>
                  {stationList.filter((s) => s.station_id !== stationId).map((s) => (
                    <option key={s.station_id} value={s.station_id}>
                      {s.name} ({s.state}) · {s.station_id}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={swap} disabled={!stationB} aria-label="Swap A and B">⇄</button>
              </div>
            )}
          </div>
          {station && (
            <div className="tabs" role="tablist" aria-label="View">
              {[["explore", "Explore"], ["compare", "Compare"], ["relationship", "Relationship"]].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </header>

        {comparing && variables.data && (
          <CompareView
            stationA={station}
            stationB={stationB}
            variables={variables.data}
            chosenVariable={chosenVariable}
            onVariableChange={setChosenVariable}
            range={range}
            onRangeChange={setRange}
          />
        )}

        {station && mode === "relationship" && variables.data && (
          <RegressionView
            station={station}
            stations={stationList}
            variables={variables.data}
            onSelectStation={setStationId}
            range={range}
            onRangeChange={setRange}
          />
        )}

        {station && mode === "explore" && variables.data && (
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

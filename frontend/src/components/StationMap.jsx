/**
 * StationMap - FR-03 (Map selection)
 *
 * Renders BOM weather stations as markers on an interactive map. Clicking a
 * marker calls onSelect so the dashboard can refresh its chart and table.
 *
 * Originally by Rithik (4a91507). Controlled by the dashboard: it receives the
 * station list from /api/v1/stations (only stations with data in the database,
 * so every marker opens a chart) and the selected ids.
 *
 * Explore: the selected station's pin is recoloured and drawn on top.
 * Compare (FR-04): station A's pin keeps the blue pin and B's is orange, the
 * same colours as their lines on the chart, each labelled with its letter;
 * other pins fade so the pair stands out, and the map fits both in view.
 * Relationship (FR-05): `dimmed` fades stations a relationship can't be
 * fitted at (only one variable), so the usable ones stand out.
 *
 * Marker images are imported from the leaflet package so the bundler ships
 * them. Leaflet's own default-icon lookup guesses a path that does not exist in
 * a Vite build, which left every marker as a broken image, and the earlier red
 * "selected" pin was fetched from GitHub at runtime, which fails offline.
 */

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const PIN = {
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [0, -38],
  shadowSize: [41, 41],
};
const DEFAULT_ICON = new L.Icon(PIN);
// Same pin, recoloured in CSS (.station-pin--selected) so nothing is fetched at runtime.
const SELECTED_ICON = new L.Icon({ ...PIN, className: "station-pin--selected" });
// Pin colour by the data a station has, recoloured the same way: light sky
// blue for rainfall only, green when it also records temperature. Every
// station in the database has rainfall. The plain blue pin is kept for
// Compare's station A, so a rainfall-only pin is never mistaken for it.
const RAINFALL_ICON = new L.Icon({ ...PIN, className: "station-pin--rainfall" });
const TEMPERATURE_ICON = new L.Icon({ ...PIN, className: "station-pin--temperature" });
const hasTemperature = (station) => station.variables.some((v) => v.variable_code !== "rainfall");
const typeIcon = (station) => (hasTemperature(station) ? TEMPERATURE_ICON : RAINFALL_ICON);

// The key uses the marker image itself with the same CSS classes, so its
// colours always match the pins exactly.
function MapLegend({ comparing }) {
  const items = comparing
    ? [["", "Station A"], ["station-pin--selected", "Station B"]]
    : [["station-pin--selected", "Selected station"]];
  items.push(["station-pin--rainfall", "Rainfall only"], ["station-pin--temperature", "Rainfall + temperature"]);
  return (
    <div className="map-legend" aria-label="Map key">
      {items.map(([cls, label]) => (
        <span key={label}>
          <img className={`leaflet-marker-icon ${cls}`} src={markerIcon} alt="" />
          {label}
        </span>
      ))}
    </div>
  );
}

const HOME_CENTER = [-25.27, 133.78]; // roughly the centre of Australia
const HOME_ZOOM = 4;

// react-leaflet doesn't recentre on its own: fly to the selected station, or
// fit both in view when comparing, or back out to all of Australia when the
// selection is cleared.
function FollowSelection({ a, b }) {
  const map = useMap();
  const hadSelection = useRef(false);
  useEffect(() => {
    if (a && b) {
      map.flyToBounds([[a.latitude, a.longitude], [b.latitude, b.longitude]], { padding: [70, 70], maxZoom: 8, duration: 0.6 });
    } else if (a) {
      map.flyTo([a.latitude, a.longitude], Math.max(map.getZoom(), 6), { duration: 0.5 });
    } else if (hadSelection.current) {
      map.closePopup();
      map.flyTo(HOME_CENTER, HOME_ZOOM, { duration: 0.6 });
    }
    hadSelection.current = Boolean(a);
  }, [a, b, map]);
  return null;
}

export default function StationMap({ stations, selectedId, compareId = null, comparing = false, dimmed = null, onSelect }) {
  const a = stations.find((s) => s.station_id === selectedId) ?? null;
  const b = comparing ? stations.find((s) => s.station_id === compareId) ?? null : null;

  const look = (id, station) => {
    if (comparing) {
      if (id === selectedId) return { icon: DEFAULT_ICON, z: 1000, opacity: 1, label: "A" };
      if (id === compareId) return { icon: SELECTED_ICON, z: 1000, opacity: 1, label: "B" };
      return { icon: typeIcon(station), z: 0, opacity: 0.45, label: null };
    }
    return id === selectedId
      ? { icon: SELECTED_ICON, z: 1000, opacity: 1, label: null }
      : { icon: typeIcon(station), z: 0, opacity: dimmed?.(station) ? 0.35 : 1, label: null };
  };

  return (
    <>
      <MapContainer
        center={HOME_CENTER}
        zoom={HOME_ZOOM}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
  
        {stations.map((station) => {
          const { icon, z, opacity, label } = look(station.station_id, station);
          return (
            <Marker
              key={`${station.station_id}|${label ?? ""}`}
              position={[station.latitude, station.longitude]}
              icon={icon}
              opacity={opacity}
              zIndexOffset={z}
              eventHandlers={{ click: () => onSelect(station.station_id) }}
              title={station.name}
            >
              {label && (
                <Tooltip permanent direction="top" className={`station-label station-label--${label.toLowerCase()}`}>
                  {label}
                </Tooltip>
              )}
              <Popup>
                <strong>{station.name}</strong>
                <br />
                {station.state} · {station.variables.map((v) => v.variable_code).join(", ")}
              </Popup>
            </Marker>
          );
        })}
  
        <FollowSelection a={a} b={b} />
      </MapContainer>
      <MapLegend comparing={comparing} />
    </>
  );
}

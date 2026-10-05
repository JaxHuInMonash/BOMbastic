/**
 * StationMap - FR-03 (Map selection)
 *
 * Renders BOM weather stations as markers on an interactive map. Clicking a
 * marker selects that station, highlights it, and calls onSelect so the
 * dashboard can refresh its chart and table for the new location.
 *
 * Originally by Rithik (4a91507). Now controlled by the dashboard: it receives
 * the station list from /api/v1/stations (only stations with data in the
 * database, so every marker opens a chart) and the selected id, so a station
 * picked from the keyboard-accessible list highlights here too.
 *
 * Marker images are imported from the leaflet package so the bundler ships
 * them. Leaflet's own default-icon lookup guesses a path that does not exist in
 * a Vite build, which left every marker as a broken image, and the earlier red
 * "selected" pin was fetched from GitHub at runtime, which fails offline.
 */

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
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
  shadowSize: [41, 41],
};
const DEFAULT_ICON = new L.Icon(PIN);
// Same pin, recoloured in CSS (.station-pin--selected) so nothing is fetched at runtime.
const SELECTED_ICON = new L.Icon({ ...PIN, className: "station-pin--selected" });

// react-leaflet doesn't auto-recentre when the selected marker changes;
// this small helper does it so the UX feels responsive on selection.
function RecenterOnSelect({ station }) {
  const map = useMap();
  useEffect(() => {
    if (station) {
      map.flyTo([station.latitude, station.longitude], Math.max(map.getZoom(), 6), {
        duration: 0.5,
      });
    }
  }, [station, map]);
  return null;
}

export default function StationMap({ stations, selectedId, onSelect }) {
  const selected = stations.find((s) => s.station_id === selectedId) ?? null;

  return (
    <MapContainer
      center={[-25.27, 133.78]} // roughly the centre of Australia
      zoom={4}
      style={{ height: "100%", width: "100%", minHeight: 480 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {stations.map((station) => (
        <Marker
          key={station.station_id}
          position={[station.latitude, station.longitude]}
          icon={station.station_id === selectedId ? SELECTED_ICON : DEFAULT_ICON}
          zIndexOffset={station.station_id === selectedId ? 1000 : 0}
          eventHandlers={{ click: () => onSelect(station.station_id) }}
          title={station.name}
        >
          <Popup>
            <strong>{station.name}</strong>
            <br />
            {station.state} · {station.variables.map((v) => v.variable_code).join(", ")}
          </Popup>
        </Marker>
      ))}

      <RecenterOnSelect station={selected} />
    </MapContainer>
  );
}

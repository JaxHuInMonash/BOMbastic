/**
 * StationMap - FR-03 (Map selection)
 *
 * Renders BOM weather stations as markers on an interactive map.
 * Clicking a marker selects that station, highlights it, and calls
 * onStationSelect so the parent dashboard can refresh its chart/table
 * for the new location.
 *
 * Needs: npm install leaflet react-leaflet
 * (leaflet's default marker icons need the CSS import below, and the
 * icon fix - see setupLeafletIcons - or markers render as broken images)
 */

import { useEffect, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API_BASE = import.meta.env?.VITE_API_BASE ?? "http://localhost:8000";

const DEFAULT_ICON = new L.Icon.Default();
const SELECTED_ICON = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// react-leaflet doesn't auto-recentre when the selected marker changes;
// this small helper does it so the UX feels responsive on selection.
function RecenterOnSelect({ station }) {
  const map = useMap();
  useEffect(() => {
    if (station) {
      map.flyTo([station.lat, station.lon], Math.max(map.getZoom(), 6), {
        duration: 0.5,
      });
    }
  }, [station, map]);
  return null;
}

export default function StationMap({ onStationSelect }) {
  const [stations, setStations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/stations`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load stations (${res.status})`);
        return res.json();
      })
      .then(setStations)
      .catch((err) => setError(err.message));
  }, []);

  const handleMarkerClick = useCallback(
    (station) => {
      setSelected(station);
      onStationSelect?.(station);
    },
    [onStationSelect]
  );

  if (error) {
    return <div role="alert">Couldn't load stations: {error}</div>;
  }

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
          position={[station.lat, station.lon]}
          icon={selected?.station_id === station.station_id ? SELECTED_ICON : DEFAULT_ICON}
          eventHandlers={{ click: () => handleMarkerClick(station) }}
        >
          <Popup>
            <strong>{station.name}</strong>
            <br />
            {station.state}
          </Popup>
        </Marker>
      ))}

      <RecenterOnSelect station={selected} />
    </MapContainer>
  );
}

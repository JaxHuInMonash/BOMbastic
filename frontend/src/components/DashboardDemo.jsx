/**
 * Standalone demo wrapper for sign-off: proves FR-03 and NFR-05 work
 * together end to end. Selecting a station on the map (FR-03) loads
 * that station's rainfall history with missing/accumulated/unverified
 * readings clearly marked (NFR-05), rather than the two being separate
 * pieces that only work in isolation.
 */

import { useState } from "react";
import StationMap from "./StationMap";
import RainfallPanel from "./RainfallPanel";

export default function DashboardDemo() {
  const [selectedStation, setSelectedStation] = useState(null);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ flex: 2 }}>
        <StationMap onStationSelect={setSelectedStation} />
      </div>
      <div style={{ flex: 1, padding: 16, borderLeft: "1px solid #ddd", overflowY: "auto" }}>
        <h3>Selected station</h3>
        {selectedStation ? (
          <>
            <ul>
              <li><strong>Name:</strong> {selectedStation.name}</li>
              <li><strong>State:</strong> {selectedStation.state}</li>
              <li><strong>Station ID:</strong> {selectedStation.station_id}</li>
            </ul>
            <RainfallPanel stationId={selectedStation.station_id} />
          </>
        ) : (
          <p>Click a marker to select a station.</p>
        )}
      </div>
    </div>
  );
}

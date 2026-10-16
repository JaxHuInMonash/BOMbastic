/**
 * The one place the frontend talks to the BOMbastic API (/api/v1).
 *
 * Every request can be cancelled, so a slow response for a station the user
 * has already left can never overwrite the one they are looking at now.
 */

export const API_BASE = import.meta.env?.VITE_API_BASE ?? "http://localhost:8000";

/** An API answer that is not a success, kept distinct so the UI can say why. */
export class ApiError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.kind = kind; // "unreachable" | "unavailable" | "invalid" | "not_found" | "server"
    this.status = status;
  }
}

export async function getJSON(path, params = {}, signal) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  return request(`${API_BASE}${path}${query.size ? `?${query}` : ""}`, { signal });
}

/** POST a JSON body; used for computations such as /api/v1/regressions (report §5.3). */
export function postJSON(path, body, signal) {
  return request(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== ""))),
    signal,
  });
}

async function request(url, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(
      "unreachable",
      `Can't reach the BOMbastic API at ${API_BASE}. Is the backend running?`,
    );
  }

  if (response.ok) return response.json();

  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    if (typeof body.detail === "string") detail = body.detail;
    else if (Array.isArray(body.detail)) detail = body.detail.map((d) => d.msg).join("; ");
  } catch {
    /* body was not JSON; keep the status line */
  }
  const kind =
    response.status === 503 ? "unavailable"
    : response.status === 422 ? "invalid"
    : response.status === 404 ? "not_found"
    : "server";
  throw new ApiError(kind, detail, response.status);
}

export const api = {
  stations: (signal) => getJSON("/api/v1/stations", {}, signal),
  variables: (signal) => getJSON("/api/v1/variables", {}, signal),
  observations: ({ stationId, variable, start, end }, signal) =>
    getJSON("/api/v1/observations", { station_id: stationId, variable, start, end }, signal),
  regression: ({ stationId, x, y, start, end, qualityPolicy }, signal) =>
    postJSON("/api/v1/regressions", { station_id: stationId, x, y, start, end, quality_policy: qualityPolicy }, signal),
};

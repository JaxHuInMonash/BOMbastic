import { useCallback, useEffect, useState } from "react";
import { api } from "./client";

/**
 * Fetch `fetcher(params)` whenever the params change, cancelling the previous
 * request so a slow, outdated answer can never overwrite a newer one.
 *
 * The result remembers which request it answers. While a newer request is in
 * flight, `loading` is true and the previous data is still returned, so a chart
 * can hold its last frame at reduced opacity instead of flashing empty.
 */
function useRequest(fetcher, params) {
  const [attempt, setAttempt] = useState(0);
  const key = params ? JSON.stringify([params, attempt]) : null;
  const [result, setResult] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    if (!key) return undefined;
    const [requestParams] = JSON.parse(key);
    const controller = new AbortController();
    fetcher(requestParams, controller.signal)
      .then((data) => setResult({ key, data, error: null }))
      .catch((error) => {
        if (error.name === "AbortError") return;
        setResult((previous) => ({ key, data: previous.data, error }));
      });
    return () => controller.abort();
  }, [fetcher, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = result.key === key;
  return {
    data: result.data,
    error: current ? result.error : null,
    loading: Boolean(key) && !current,
    retry,
  };
}

const fetchStations = (_params, signal) => api.stations(signal);
const fetchVariables = (_params, signal) => api.variables(signal);
const fetchObservations = (params, signal) => api.observations(params, signal);

export function useStations() {
  return useRequest(fetchStations, {});
}

export function useVariables() {
  return useRequest(fetchVariables, {});
}

/** query: { stationId, variable, start?, end? }. Nothing is fetched until both ids are set. */
export function useObservations(query) {
  const ready = Boolean(query.stationId && query.variable);
  return useRequest(fetchObservations, ready ? query : null);
}

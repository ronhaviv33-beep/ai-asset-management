import { useState, useEffect, useCallback } from "react";
import { getToken, authFetch, fetchTeams, getDemoMode, BASE } from "../api.js";

export function useLiveData(intervalMs = 30_000) {
  const [apiRecords, setApiRecords] = useState(null); // null = loading, [] = empty
  const [serverTeams, setServerTeams] = useState([]);
  const [serverAlerts, setServerAlerts] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const [demoMode, setDemoModeState] = useState(true);

  const load = useCallback(async () => {
    if (!getToken()) { setApiRecords([]); return; }
    try {
      const [telR, teamsR, alertsR, dm] = await Promise.all([
        authFetch(`${BASE}/telemetry?limit=1000`),
        fetchTeams().catch(() => []),
        authFetch(`${BASE}/security/alerts`).catch(() => null),
        getDemoMode().catch(() => true),
      ]);
      if (!telR || !telR.ok) throw new Error("API error");
      const data = await telR.json();
      setApiRecords(data);
      setServerTeams(Array.isArray(teamsR) ? teamsR : []);
      if (alertsR?.ok) {
        const sa = await alertsR.json();
        setServerAlerts(Array.isArray(sa) ? sa : []);
      }
      setDemoModeState(!!dm);
      setIsLive(!dm);
      setLastRefresh(new Date());
    } catch {
      setApiRecords([]); // fall back to demo
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  return { apiRecords, serverTeams, serverAlerts, lastRefresh, isLive, demoMode, setDemoModeState, refresh: load };
}

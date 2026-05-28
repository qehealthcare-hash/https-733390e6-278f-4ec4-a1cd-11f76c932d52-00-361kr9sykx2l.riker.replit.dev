"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { request } from "@/lib/api-client";

function resolveTables(options) {
  if (Array.isArray(options.tables) && options.tables.length) {
    return options.tables;
  }
  if (options.table) {
    return [options.table];
  }
  return [];
}

function normalizeListPayload(response) {
  if (Array.isArray(response)) {
    return { rows: response, total: response.length };
  }
  if (response && Array.isArray(response.rows)) {
    return {
      rows: response.rows,
      total: typeof response.total === "number" ? response.total : response.rows.length
    };
  }
  return { rows: [], total: 0 };
}

export function useRealtimeResource(options) {
  const auth = useAuth();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Keep the latest apiPath in a ref so the realtime channel callback always
  // refetches from the *current* URL (search/page-size can change at runtime)
  // without forcing the channel to re-subscribe on every keystroke.
  const apiPathRef = useRef(options.apiPath);
  const sessionRef = useRef(auth.session);
  const debounceRef = useRef(null);

  useEffect(() => {
    apiPathRef.current = options.apiPath;
  }, [options.apiPath]);

  useEffect(() => {
    sessionRef.current = auth.session;
  }, [auth.session]);

  // P1-1: fetchOnce takes an AbortSignal and short-circuits before every
  // setX call. The previous closure-scoped `cancelled` var let setData run
  // even after the apiPath changed (or the component unmounted), so a slow
  // network response could overwrite the next request's results.
  const fetchOnce = useCallback(
    async function fetchOnce(currentPath, signalArg) {
      const session = sessionRef.current;
      if (!session?.access_token) return;
      // reload() may invoke fetchOnce without a signal; treat that as never-aborted.
      const signal = signalArg || { aborted: false };
      if (signal.aborted) return;
      setLoading(true);
      try {
        const response = await request(currentPath, null, session);
        if (signal.aborted) return;
        const payload = normalizeListPayload(response);
        if (signal.aborted) return;
        setData(payload.rows);
        if (signal.aborted) return;
        setTotal(payload.total);
        if (signal.aborted) return;
        setError("");
      } catch (err) {
        if (signal.aborted) return;
        setError(err?.message || "Could not load data");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    []
  );

  // Fetch whenever apiPath changes (search, page size, filter switches).
  useEffect(
    function () {
      if (!auth.session?.access_token) return undefined;
      const controller = new AbortController();
      (async function () {
        await fetchOnce(options.apiPath, controller.signal);
      })();
      return function () { controller.abort(); };
    },
    [auth.session, options.apiPath, fetchOnce]
  );

  // Subscribe to realtime once per (session, channel, tables). Refetch using
  // the *latest* apiPath via the ref, so the subscription does NOT re-tear
  // down when the user types in the search box.
  const channelName = options.channel;
  const tablesKey = Array.isArray(options.tables)
    ? options.tables.join("|")
    : options.table || "";
  const tablesList = tablesKey ? tablesKey.split("|").filter(Boolean) : [];
  // Stash the resolved list on a ref so the effect closure sees a stable copy
  // and lint is happy with a primitive dep key.
  const tablesRef = useRef(tablesList);
  useEffect(() => {
    tablesRef.current = tablesList;
  }, [tablesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    function () {
      if (!auth.session?.access_token) return undefined;
      const tables = tablesRef.current;
      if (!tables.length) return undefined;

      // P1-1: per-subscription AbortController so debounced refetches that
      // fire AFTER unmount cannot setX into a torn-down component.
      const controller = new AbortController();
      function scheduleFetch() {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(function () {
          debounceRef.current = null;
          if (controller.signal.aborted) return;
          fetchOnce(apiPathRef.current, controller.signal);
        }, 250);
      }

      const channel = auth.supabase.channel("crm-" + channelName);
      tables.forEach(function (tableName) {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: tableName
          },
          scheduleFetch
        );
      });
      channel.subscribe();

      return function cleanup() {
        controller.abort();
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        auth.supabase.removeChannel(channel);
      };
    },
    [auth.session, auth.supabase, channelName, tablesKey, fetchOnce]
  );

  return {
    data,
    total,
    loading,
    error,
    reload: function reload() {
      return fetchOnce(apiPathRef.current, null);
    }
  };
}

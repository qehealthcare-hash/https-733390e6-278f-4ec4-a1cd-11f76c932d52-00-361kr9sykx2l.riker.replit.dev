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
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.rows)) return response.rows;
  return [];
}

export function useRealtimeResource(options) {
  const auth = useAuth();
  const [data, setData] = useState([]);
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

  const fetchOnce = useCallback(
    async function fetchOnce(currentPath) {
      const session = sessionRef.current;
      if (!session?.access_token) return;
      setLoading(true);
      try {
        const response = await request(currentPath, null, session);
        setData(normalizeListPayload(response));
        setError("");
      } catch (err) {
        // Surface a friendly message; never throw out of the hook.
        setError(err?.message || "Could not load data");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Fetch whenever apiPath changes (search, page size, filter switches).
  useEffect(
    function () {
      if (!auth.session?.access_token) return undefined;
      let cancelled = false;
      (async function () {
        await fetchOnce(options.apiPath);
        if (cancelled) return;
      })();
      return function () { cancelled = true; };
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

      function scheduleFetch() {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(function () {
          debounceRef.current = null;
          fetchOnce(apiPathRef.current);
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
    loading,
    error,
    reload: function reload() {
      return fetchOnce(apiPathRef.current);
    }
  };
}

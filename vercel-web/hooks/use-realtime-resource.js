"use client";

import { useEffect, useRef, useState } from "react";
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
  const debounceRef = useRef(null);

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      let active = true;
      const tables = resolveTables(options);

      async function fetchData() {
        setLoading(true);
        try {
          const response = await request(options.apiPath, null, auth.session);
          if (active) setData(normalizeListPayload(response));
          if (active) setError("");
        } catch (err) {
          if (active) setError(err.message);
        } finally {
          if (active) setLoading(false);
        }
      }

      function scheduleFetch() {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(function () {
          debounceRef.current = null;
          fetchData();
        }, 250);
      }

      fetchData();

      const channel = auth.supabase.channel("crm-" + options.channel);
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
        active = false;
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        auth.supabase.removeChannel(channel);
      };
    },
    [
      auth.session,
      auth.supabase,
      options.apiPath,
      options.channel,
      Array.isArray(options.tables) ? options.tables.join("|") : options.table || ""
    ]
  );

  return {
    data,
    loading,
    error,
    reload: function reload() {
      setLoading(true);
      return request(options.apiPath, null, auth.session)
        .then(function (response) {
          setData(normalizeListPayload(response));
          setError("");
        })
        .catch(function (err) {
          setError(err.message);
        })
        .finally(function () {
          setLoading(false);
        });
    }
  };
}

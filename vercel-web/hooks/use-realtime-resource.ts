"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { ApiSession } from "@/lib/clients/types";

type RealtimeAuth = {
  session?: { access_token?: string } | null;
  supabase?: {
    channel: (name: string) => {
      on: (
        event: string,
        filter: { event: string; schema: string; table: string },
        handler: () => void
      ) => { on: (...args: unknown[]) => unknown; subscribe: () => void };
      subscribe: () => void;
    };
    removeChannel: (channel: unknown) => void;
  };
};

export type RealtimeResourceOptions = {
  channel: string;
  table?: string;
  tables?: string[];
  fetchList: (session: ApiSession) => Promise<unknown>;
};

export type RealtimeResourceResult<T = Record<string, unknown>> = {
  data: T[];
  total: number;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
};

function normalizeListPayload(response: unknown): { rows: Record<string, unknown>[]; total: number } {
  if (Array.isArray(response)) {
    return { rows: response as Record<string, unknown>[], total: response.length };
  }
  if (response && typeof response === "object" && Array.isArray((response as { rows?: unknown }).rows)) {
    const envelope = response as { rows: Record<string, unknown>[]; total?: number };
    return {
      rows: envelope.rows,
      total: typeof envelope.total === "number" ? envelope.total : envelope.rows.length
    };
  }
  return { rows: [], total: 0 };
}

export function useRealtimeResource<T = Record<string, unknown>>(
  options: RealtimeResourceOptions
): RealtimeResourceResult<T> {
  const auth = useAuth() as unknown as RealtimeAuth;
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fetchListRef = useRef(options.fetchList);
  const sessionRef = useRef(auth.session);
  const supabaseRef = useRef(auth.supabase);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accessToken = auth.session?.access_token;

  useEffect(() => {
    fetchListRef.current = options.fetchList;
  }, [options.fetchList]);

  useEffect(() => {
    sessionRef.current = auth.session;
    supabaseRef.current = auth.supabase;
  }, [auth.session, auth.supabase]);

  const fetchOnce = useCallback(async function fetchOnce(signalArg?: AbortSignal | null) {
    const session = sessionRef.current;
    if (!session?.access_token) return;
    const signal = signalArg || { aborted: false };
    if (signal.aborted) return;

    setLoading(true);
    try {
      const response = await fetchListRef.current(session);
      if (signal.aborted) return;
      const payload = normalizeListPayload(response);
      if (signal.aborted) return;
      setData(payload.rows as T[]);
      if (signal.aborted) return;
      setTotal(payload.total);
      if (signal.aborted) return;
      setError("");
    } catch (err: unknown) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : "Could not load data");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(
    function () {
      if (!accessToken) return undefined;
      const controller = new AbortController();
      void fetchOnce(controller.signal);
      return function () {
        controller.abort();
      };
    },
    [accessToken, options.fetchList, fetchOnce]
  );

  const channelName = options.channel;
  const tablesKey = Array.isArray(options.tables)
    ? options.tables.join("|")
    : options.table || "";
  const tablesList = tablesKey ? tablesKey.split("|").filter(Boolean) : [];
  const tablesRef = useRef(tablesList);
  useEffect(() => {
    tablesRef.current = tablesList;
  }, [tablesKey]);

  useEffect(
    function () {
      const supabase = supabaseRef.current;
      if (!accessToken || !supabase) return undefined;
      const tables = tablesRef.current;
      if (!tables.length) return undefined;

      const controller = new AbortController();
      function scheduleFetch() {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(function () {
          debounceRef.current = null;
          if (controller.signal.aborted) return;
          void fetchOnce(controller.signal);
        }, 250);
      }

      const channel = supabase.channel("crm-" + channelName);
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
        supabase.removeChannel(channel);
      };
    },
    [accessToken, channelName, tablesKey, fetchOnce]
  );

  return {
    data,
    total,
    loading,
    error,
    reload: function reload() {
      return fetchOnce(null);
    }
  };
}

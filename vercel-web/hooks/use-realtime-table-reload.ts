"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type RealtimeAuth = {
  session?: { access_token?: string } | null;
  supabase?: {
    channel: (name: string) => {
      on: (
        event: string,
        filter: { event: string; schema: string; table: string },
        handler: () => void
      ) => { subscribe: () => void };
      subscribe: () => void;
    };
    removeChannel: (channel: unknown) => void;
  };
};

/**
 * Debounced Supabase realtime → reload hook for list pages that do not use
 * `usePaginatedResource` (e.g. vendors, doctors).
 */
export function useRealtimeTableReload(
  tables: string[],
  channel: string,
  onReload: () => void | Promise<void>,
  debounceMs = 300
): void {
  const auth = useAuth() as RealtimeAuth | null;
  const accessToken = auth?.session?.access_token;
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const tablesKey = tables.join("|");

  useEffect(
    function () {
      const supabase = auth?.supabase;
      if (!accessToken || !supabase || !tables.length) return undefined;

      let debounce: ReturnType<typeof setTimeout> | null = null;
      let inFlight = false;

      function scheduleReload() {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(function () {
          debounce = null;
          if (inFlight) return;
          inFlight = true;
          Promise.resolve(onReloadRef.current()).finally(function () {
            inFlight = false;
          });
        }, debounceMs);
      }

      const ch = supabase.channel("crm-" + channel);
      tables.forEach(function (tableName) {
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table: tableName },
          scheduleReload
        );
      });
      ch.subscribe();

      return function cleanup() {
        if (debounce) clearTimeout(debounce);
        supabase.removeChannel(ch);
      };
    },
    [accessToken, auth?.supabase, channel, tablesKey, debounceMs]
  );
}

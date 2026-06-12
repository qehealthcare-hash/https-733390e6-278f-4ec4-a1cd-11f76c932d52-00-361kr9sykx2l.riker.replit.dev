"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiSession, ClientListParams } from "@/lib/clients/types";
import { useRealtimeResource, type RealtimeResourceOptions } from "@/hooks/use-realtime-resource";

type PaginatedResourceBase = Omit<RealtimeResourceOptions, "fetchList"> & {
  queryParams?: ClientListParams;
  resetKey?: string;
  pageSize?: number;
};

export type PaginatedResourceOptions = PaginatedResourceBase & {
  list: (session: ApiSession, params: ClientListParams) => Promise<unknown>;
};

export function usePaginatedResource<T = Record<string, unknown>>(
  options: PaginatedResourceOptions
) {
  const initialSize = options.pageSize ?? 50;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);

  const resetKey = options.resetKey ?? "";
  useEffect(
    function () {
      setPage(1);
    },
    [resetKey, pageSize]
  );

  const offset = (page - 1) * pageSize;

  const listParams = useMemo(
    function () {
      return {
        limit: pageSize,
        offset,
        ...(options.queryParams || {})
      };
    },
    [options.queryParams, pageSize, offset]
  );

  const fetchList = useMemo(
    function () {
      const listFn = options.list;
      return function (session: ApiSession) {
        return listFn(session, listParams);
      };
    },
    [options.list, listParams]
  );

  const resource = useRealtimeResource<T>({
    fetchList,
    table: options.table,
    tables: options.tables,
    channel: options.channel
  });

  const pageCount = Math.max(1, Math.ceil((resource.total || 0) / pageSize) || 1);
  useEffect(
    function () {
      if (page > pageCount) setPage(pageCount);
    },
    [page, pageCount]
  );

  return {
    data: resource.data,
    total: resource.total,
    loading: resource.loading,
    error: resource.error,
    reload: resource.reload,
    page,
    pageSize,
    pageCount,
    setPage,
    setPageSize: function (nextSize: number) {
      setPageSize(nextSize);
      setPage(1);
    }
  };
}

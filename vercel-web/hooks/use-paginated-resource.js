"use client";

import { useEffect, useMemo, useState } from "react";
import { useRealtimeResource } from "@/hooks/use-realtime-resource";

/**
 * Paginated list fetch with realtime invalidation.
 * Builds `apiPath` as `${basePath}?limit=&offset=&…` from `queryParams`.
 */
export function usePaginatedResource(options) {
  var initialSize = options.pageSize ?? 50;
  var [page, setPage] = useState(1);
  var [pageSize, setPageSize] = useState(initialSize);

  var resetKey = options.resetKey ?? "";
  useEffect(
    function () {
      setPage(1);
    },
    [resetKey, pageSize]
  );

  var offset = (page - 1) * pageSize;
  var apiPath = useMemo(
    function () {
      var params = ["limit=" + pageSize, "offset=" + offset];
      var extra = options.queryParams || {};
      Object.keys(extra).forEach(function (key) {
        var value = extra[key];
        if (value === undefined || value === null || value === "") return;
        params.push(key + "=" + encodeURIComponent(String(value)));
      });
      return options.basePath + "?" + params.join("&");
    },
    [options.basePath, options.queryParams, pageSize, offset]
  );

  var resource = useRealtimeResource({
    apiPath: apiPath,
    table: options.table,
    tables: options.tables,
    channel: options.channel
  });

  var pageCount = Math.max(1, Math.ceil((resource.total || 0) / pageSize) || 1);
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
    page: page,
    pageSize: pageSize,
    pageCount: pageCount,
    setPage: setPage,
    setPageSize: function (nextSize) {
      setPageSize(nextSize);
      setPage(1);
    }
  };
}

"use client";

/**
 * Server-driven list pagination control.
 * `page` is 1-based; `total` is the full row count from the API.
 */
export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions
}) {
  var safeTotal = Math.max(0, Number(total) || 0);
  var safeSize = Math.max(1, Number(pageSize) || 50);
  var pageCount = Math.max(1, Math.ceil(safeTotal / safeSize) || 1);
  var safePage = Math.min(Math.max(1, Number(page) || 1), pageCount);
  var start = safeTotal === 0 ? 0 : (safePage - 1) * safeSize + 1;
  var end = Math.min(safePage * safeSize, safeTotal);
  var sizes = pageSizeOptions || [25, 50, 100, 200];

  return (
    <div className="pagination-bar" role="navigation" aria-label="Pagination">
      <div className="pagination-bar-meta mini-muted">
        {safeTotal
          ? "Showing " + start + "–" + end + " of " + safeTotal
          : "No rows"}
      </div>
      <div className="pagination-bar-controls">
        {onPageSizeChange ? (
          <label className="pagination-bar-size">
            <span className="sr-only">Rows per page</span>
            <select
              value={String(safeSize)}
              onChange={function (event) {
                onPageSizeChange(parseInt(event.target.value, 10) || safeSize);
              }}
              aria-label="Rows per page"
            >
              {sizes.map(function (size) {
                return (
                  <option key={size} value={String(size)}>
                    {size} / page
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="button secondary"
          disabled={safePage <= 1}
          onClick={function () { onPageChange(safePage - 1); }}
          aria-label="Previous page"
        >
          Previous
        </button>
        <span className="pagination-bar-page mini-muted" aria-live="polite">
          Page {safePage} of {pageCount}
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={safePage >= pageCount}
          onClick={function () { onPageChange(safePage + 1); }}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

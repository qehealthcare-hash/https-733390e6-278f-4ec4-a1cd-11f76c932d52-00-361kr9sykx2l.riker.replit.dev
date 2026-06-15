/** Dispatched after the offline mutation queue flushes successfully. */
export const DATA_INVALIDATED_EVENT = "hhcrm-data-invalidated";

export function dispatchDataInvalidated(source?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DATA_INVALIDATED_EVENT, { detail: { source: source || "sync" } })
  );
}

export function onDataInvalidated(handler: () => void): () => void {
  if (typeof window === "undefined") return function () {};
  const wrapped = function () {
    handler();
  };
  window.addEventListener(DATA_INVALIDATED_EVENT, wrapped);
  return function cleanup() {
    window.removeEventListener(DATA_INVALIDATED_EVENT, wrapped);
  };
}

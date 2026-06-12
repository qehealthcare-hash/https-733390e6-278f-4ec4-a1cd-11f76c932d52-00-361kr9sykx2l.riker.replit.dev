import { useCallback, useRef, useState } from "react";

/**
 * P1-D: blocks duplicate form submits before React re-renders `disabled={busy}`.
 * Call `tryBegin()` at the start of a handler; always pair with `end()` in `finally`.
 */
export function useBusyGuard() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const tryBegin = useCallback(function (): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }, []);

  const end = useCallback(function () {
    busyRef.current = false;
    setBusy(false);
  }, []);

  return { busy, tryBegin, end };
}

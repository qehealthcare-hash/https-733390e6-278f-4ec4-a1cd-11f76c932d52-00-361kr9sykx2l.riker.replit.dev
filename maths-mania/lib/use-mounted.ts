"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Hydration-safe "am I on the client yet?" hook.
 *
 * Uses `useSyncExternalStore` so React treats the server/client divergence
 * as expected — no `setState` inside `useEffect`, no `react-hooks/set-state-in-effect`
 * lint violation, no hydration warnings. Preferred over the historical
 * `const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), [])`
 * pattern.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

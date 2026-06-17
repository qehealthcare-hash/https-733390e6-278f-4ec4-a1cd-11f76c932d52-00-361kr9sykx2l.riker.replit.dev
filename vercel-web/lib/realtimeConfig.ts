/**
 * Central switch for Supabase Realtime postgres_changes subscriptions.
 * Set NEXT_PUBLIC_ENABLE_REALTIME=0 in Vercel when the database is saturated
 * (realtime WAL decoding is a common contributor to lock/timeout storms).
 */
export function isRealtimeEnabled(): boolean {
  const raw = String(process.env.NEXT_PUBLIC_ENABLE_REALTIME ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

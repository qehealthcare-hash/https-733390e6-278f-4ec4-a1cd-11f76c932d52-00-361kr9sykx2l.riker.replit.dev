/**
 * Browser offline mutation queue — flushed after auth session is restored.
 * Implementation lives in `api-client`; this module is the UI entry point.
 */
export { flushOfflineQueue } from "@/lib/api-client";

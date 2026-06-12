/** Query params accepted by paginated list endpoints and `withQuery`. */
export type ClientListParams = Record<string, string | number | boolean | undefined | null>;

export type { ApiSession, ApiRequestOptions } from "@/lib/api-client";

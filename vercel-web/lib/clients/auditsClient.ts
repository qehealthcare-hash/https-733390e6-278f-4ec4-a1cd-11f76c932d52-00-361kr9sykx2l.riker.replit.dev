import { request } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const AUDITS_BASE = "/audits";

export const auditsClient = {
  basePath: AUDITS_BASE,

  list(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(AUDITS_BASE, params), null, session);
  }
};

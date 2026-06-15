import { requestValidated } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { actorMeDtoSchema } from "@/validation/authDto";

export const authClient = {
  me(session: ApiSession) {
    return requestValidated("/auth/me", null, session, actorMeDtoSchema);
  }
};

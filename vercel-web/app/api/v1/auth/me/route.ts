import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  return jsonOk({
    id: actor.userId,
    email: actor.email,
    username: actor.username,
    role: actor.role
  });
});

import { withAuth } from "@/lib/api/handler";
import { loadRolePermissions } from "@/lib/api/rolePermissions";
import { respond } from "@/lib/api/apiResultBridge";
import { success } from "@/utils/apiResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  const permissions = await loadRolePermissions(actor.role);
  return respond(
    success({
      id: actor.userId,
      email: actor.email,
      username: actor.username,
      role: actor.role,
      permissions
    })
  );
});

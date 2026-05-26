/**
 * Canonical actor type passed from API routes into domain services.
 *
 * Layering contract:
 *   - `lib/api/auth.ts` builds a richer `ActorContext` (with `username`
 *     and a guaranteed `accessToken`) from the Supabase JWT.
 *   - Route handlers project that down to `ServiceActor` when calling a
 *     service. Services and business code import ONLY this type so the
 *     HTTP-layer `ActorContext` stays scoped to routes.
 *
 * `userId` maps to `hh_users.id` when the caller is provisioned in the
 * CRM. `accessToken` is required when the service must write under the
 * caller's RLS (otherwise the service falls back to the admin client).
 */
export interface ServiceActor {
  email: string;
  userId?: string;
  role?: string;
  accessToken?: string;
}

/**
 * Standard `{ actor, accessToken? }` context every service method
 * accepts. The optional top-level `accessToken` lets internal jobs
 * pass a token without forging a full actor.
 */
export interface ServiceContext {
  actor: ServiceActor;
  accessToken?: string;
}

/** @deprecated Use ServiceActor — kept for one release for source-compat. */
export type ActorLike = ServiceActor;

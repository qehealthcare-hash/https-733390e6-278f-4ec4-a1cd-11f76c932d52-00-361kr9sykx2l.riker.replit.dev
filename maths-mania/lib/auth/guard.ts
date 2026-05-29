/**
 * Auth guard helpers (server-only).
 *
 * Prefer `requireAuth()` in layouts and Server Components.
 * Milestone 10 — wraps session helpers for the brief's "AuthGuard" name.
 */

export {
  requireAuth,
  requireAuth as authGuard,
  requireAdmin,
  getAuthContext,
  getUser,
  getProfile,
  needsOnboarding,
  redirectIfAuthenticated,
} from "@/lib/auth/session";

export type { AuthContext, Profile } from "@/lib/auth/session";

/**
 * Actor passed from API routes into domain services.
 * `userId` maps to `hh_users.id` when the caller is provisioned.
 */
export interface ServiceActor {
  email: string;
  userId?: string;
  role?: string;
  accessToken?: string;
}

/** @deprecated Use ServiceActor */
export type ActorLike = ServiceActor;

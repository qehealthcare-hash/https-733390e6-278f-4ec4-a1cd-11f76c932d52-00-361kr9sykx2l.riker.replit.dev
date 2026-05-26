/**
 * Edge converter: HTTP-layer `ActorContext` -> service-layer `ServiceContext`.
 *
 * Routes call `toServiceContext(actor)` once and pass the result to every
 * service method. This keeps the HTTP-only fields (`username`,
 * required `accessToken`, etc.) scoped to lib/api/* and ensures domain
 * services only see the minimal `ServiceActor` contract.
 */

import type { ActorContext } from "@/lib/api/auth";
import type { ServiceActor, ServiceContext } from "@/types/serviceActor";

export function toServiceActor(actor: ActorContext): ServiceActor {
  return {
    email: actor.email,
    userId: actor.userId,
    role: actor.role,
    accessToken: actor.accessToken
  };
}

export function toServiceContext(actor: ActorContext): ServiceContext {
  return {
    actor: toServiceActor(actor),
    accessToken: actor.accessToken
  };
}

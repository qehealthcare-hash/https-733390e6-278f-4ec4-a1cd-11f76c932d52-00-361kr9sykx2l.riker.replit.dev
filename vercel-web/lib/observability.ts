/**
 * Optional error reporting (Phase 15). Active only when `SENTRY_DSN` is set.
 * Datadog: use the Vercel ↔ Datadog integration or forward Sentry events — see OPS.md.
 */

function sentryDsn(): string | undefined {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

export function isObservabilityEnabled(): boolean {
  return Boolean(sentryDsn());
}

export async function captureServerException(
  err: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  if (!isObservabilityEnabled()) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(err, { extra: context });
  } catch {
    /* SDK unavailable — never block the request */
  }
}

export function captureServerExceptionSync(err: unknown, context?: Record<string, unknown>): void {
  void captureServerException(err, context);
}

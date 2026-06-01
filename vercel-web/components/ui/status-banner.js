/**
 * Accessible inline status banners for pages that still use a per-section
 * banner (in addition to the centralized toast). The container is always
 * rendered so aria-live updates announce properly on SR — content alone
 * toggles. Visually hidden when empty.
 *
 *   <ErrorBanner message={error} />
 *   <SuccessBanner message={message} />
 *
 * Tone-specific roles:
 *   - error  → role="alert", aria-live="assertive" (interrupt-worthy)
 *   - status → role="status", aria-live="polite"   (queued; non-interrupting)
 */

function bannerStyle(hasMessage) {
  if (hasMessage) return undefined;
  return {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0
  };
}

export function ErrorBanner({ message, className, style }) {
  const hasMessage = Boolean(message);
  const baseClass = className || "error-text";
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={hasMessage ? baseClass : ""}
      style={{ ...bannerStyle(hasMessage), ...(hasMessage ? style : null) }}
    >
      {message || ""}
    </div>
  );
}

export function SuccessBanner({ message, className, style }) {
  const hasMessage = Boolean(message);
  const baseClass = className || "success-text";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={hasMessage ? baseClass : ""}
      style={{ ...bannerStyle(hasMessage), ...(hasMessage ? style : null) }}
    >
      {message || ""}
    </div>
  );
}

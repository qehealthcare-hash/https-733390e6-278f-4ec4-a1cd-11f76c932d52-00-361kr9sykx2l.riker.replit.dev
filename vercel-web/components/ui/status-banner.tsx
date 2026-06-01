import type { CSSProperties } from "react";

type BannerProps = {
  message?: string;
  className?: string;
  style?: CSSProperties;
};

function bannerStyle(hasMessage: boolean): CSSProperties | undefined {
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

export function ErrorBanner({ message, className, style }: BannerProps) {
  const hasMessage = Boolean(message);
  const baseClass = className || "error-text";
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={hasMessage ? baseClass : ""}
      style={{ ...bannerStyle(hasMessage), ...(hasMessage ? style : undefined) }}
    >
      {message || ""}
    </div>
  );
}

export function SuccessBanner({ message, className, style }: BannerProps) {
  const hasMessage = Boolean(message);
  const baseClass = className || "success-text";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={hasMessage ? baseClass : ""}
      style={{ ...bannerStyle(hasMessage), ...(hasMessage ? style : undefined) }}
    >
      {message || ""}
    </div>
  );
}

import { SESSION_HINT_COOKIE_NAME } from "@/lib/auth/refreshCookie";

/** True when the server previously issued a refresh cookie for this browser. */
export function hasRefreshSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  const prefix = SESSION_HINT_COOKIE_NAME + "=";
  return document.cookie.split(";").some(function (part) {
    const trimmed = part.trim();
    return trimmed.startsWith(prefix) && trimmed.slice(prefix.length) === "1";
  });
}

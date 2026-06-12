import { useEffect, useId, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Focus trap, Escape-to-close, and focus restoration for page-level modals.
 */
export function useModalA11y(
  open: boolean,
  onClose: () => void,
  options?: {
    initialFocusRef?: RefObject<HTMLElement | null>;
    disabled?: boolean;
  }
) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || options?.disabled) return undefined;

    const previouslyFocused =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    const focusInitial = function () {
      const fromRef = options?.initialFocusRef?.current;
      if (fromRef && typeof fromRef.focus === "function") {
        fromRef.focus();
        return;
      }
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector(FOCUSABLE_SELECTOR) as HTMLElement | null;
      first?.focus?.();
    };
    const timerId = window.setTimeout(focusInitial, 0);

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
      if (!focusable.length) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    return function () {
      window.clearTimeout(timerId);
      document.removeEventListener("keydown", handleKey);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose, options?.disabled, options?.initialFocusRef]);

  return { dialogRef, titleId };
}

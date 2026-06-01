"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Centralized non-blocking toast notifications.
 *
 * Mirrors the `ConfirmProvider` pattern so call sites stay consistent.
 *
 *   const toast = useToast();
 *   toast.success("Receipt saved");
 *   toast.error("Could not save receipt");
 *
 * Accessibility:
 *  - Container is `aria-live="polite"` so SR users hear new toasts
 *    without losing focus.
 *  - Error toasts also set `role="alert"` for an assertive announcement.
 *
 * Falls back to a no-op outside a provider so SSR / unit tests are safe.
 * Existing per-page `setError` banners continue to work — pages can migrate
 * incrementally; nothing is removed.
 */

const ToastContext = createContext(null);

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 6500;

let nextId = 1;

export function useToast() {
  const ctx = useContext(ToastContext);
  return useMemo(() => {
    const noop = () => {};
    if (!ctx) {
      return { show: noop, success: noop, error: noop, info: noop, warn: noop, dismiss: noop };
    }
    return {
      show: ctx.show,
      success: (message, opts) => ctx.show({ ...opts, tone: "success", message }),
      error: (message, opts) =>
        ctx.show({ duration: ERROR_DURATION_MS, ...opts, tone: "error", message }),
      info: (message, opts) => ctx.show({ ...opts, tone: "info", message }),
      warn: (message, opts) => ctx.show({ ...opts, tone: "warn", message }),
      dismiss: ctx.dismiss
    };
  }, [ctx]);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (opts) => {
      const id = nextId++;
      const message = String(opts?.message ?? "").trim();
      if (!message) return id;
      const tone = opts?.tone || "info";
      const duration = Number.isFinite(opts?.duration)
        ? Math.max(800, Number(opts.duration))
        : tone === "error"
          ? ERROR_DURATION_MS
          : DEFAULT_DURATION_MS;
      setToasts((prev) => [...prev, { id, tone, message }]);
      if (duration > 0 && typeof window !== "undefined") {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="toast-stack"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map(function (t) {
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className={"toast toast-" + t.tone}
              onClick={function () { dismiss(t.id); }}
            >
              <span className="toast-message">{t.message}</span>
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss"
                onClick={function (event) {
                  event.stopPropagation();
                  dismiss(t.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

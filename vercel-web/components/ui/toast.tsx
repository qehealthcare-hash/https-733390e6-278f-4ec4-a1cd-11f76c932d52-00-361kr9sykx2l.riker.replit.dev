"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

type ToastTone = "success" | "error" | "info" | "warn";

type ToastShowOptions = {
  message?: string;
  tone?: ToastTone;
  duration?: number;
  onRetry?: () => void;
};

type ToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
  onRetry?: () => void;
};

type ToastContextValue = {
  show: (opts: ToastShowOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 6500;

let nextId = 1;

export type ToastApi = {
  show: (opts: ToastShowOptions) => number;
  success: (message: string, opts?: Omit<ToastShowOptions, "message" | "tone">) => number;
  error: (message: string, opts?: Omit<ToastShowOptions, "message" | "tone">) => number;
  info: (message: string, opts?: Omit<ToastShowOptions, "message" | "tone">) => number;
  warn: (message: string, opts?: Omit<ToastShowOptions, "message" | "tone">) => number;
  dismiss: (id: number) => void;
};

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return useMemo(() => {
    const noop = () => 0;
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (opts: ToastShowOptions) => {
      const id = nextId++;
      const message = String(opts?.message ?? "").trim();
      if (!message) return id;
      const tone = opts?.tone || "info";
      const duration = Number.isFinite(opts?.duration)
        ? Math.max(800, Number(opts.duration))
        : tone === "error"
          ? ERROR_DURATION_MS
          : DEFAULT_DURATION_MS;
      setToasts((prev) => [...prev, { id, tone, message, onRetry: opts?.onRetry }]);
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
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map(function (t) {
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className={"toast toast-" + t.tone}
              onClick={function () {
                dismiss(t.id);
              }}
            >
              <span className="toast-message">{t.message}</span>
              {t.onRetry ? (
                <button
                  type="button"
                  className="toast-retry"
                  onClick={function (event) {
                    event.stopPropagation();
                    dismiss(t.id);
                    t.onRetry?.();
                  }}
                >
                  Retry
                </button>
              ) : null}
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

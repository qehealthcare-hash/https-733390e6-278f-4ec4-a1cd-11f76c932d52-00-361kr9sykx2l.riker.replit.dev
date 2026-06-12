"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from "react";

export type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: string;
  mode?: "confirm" | "notify";
};

type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: string;
  mode: "confirm" | "notify";
};

type ConfirmContextValue = {
  open: (opts: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (opts: ConfirmOptions) => {
      if (ctx) return ctx.open(opts);
      if (typeof window === "undefined") return Promise.resolve(false);
      return Promise.resolve(
        window.confirm((opts && opts.description) || (opts && opts.title) || "Confirm?")
      );
    },
    [ctx]
  );
}

export function useNotify() {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (opts: ConfirmOptions) => {
      if (ctx) return ctx.open({ ...opts, mode: "notify" });
      if (typeof window === "undefined") return Promise.resolve(true);
      window.alert((opts && opts.description) || (opts && opts.title) || "");
      return Promise.resolve(true);
    },
    [ctx]
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const close = useCallback((value: boolean) => {
    if (resolverRef.current) {
      const fn = resolverRef.current;
      resolverRef.current = null;
      fn(value);
    }
    setRequest(null);
  }, []);

  const open = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setRequest({
        title: opts?.title || "Are you sure?",
        description: opts?.description || "",
        confirmLabel: opts?.confirmLabel || "Confirm",
        cancelLabel: opts?.cancelLabel || "Cancel",
        tone: opts?.tone || "primary",
        mode: opts?.mode || "confirm"
      });
    });
  }, []);

  useEffect(() => {
    if (!request) return undefined;
    const previouslyFocused =
      typeof document !== "undefined" ? document.activeElement : null;
    cancelBtnRef.current?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      } else if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
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
    }
    document.addEventListener("keydown", handleKey);
    return function () {
      document.removeEventListener("keydown", handleKey);
      if (previouslyFocused && typeof (previouslyFocused as HTMLElement).focus === "function") {
        (previouslyFocused as HTMLElement).focus();
      }
    };
  }, [request, close]);

  const value = { open };

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={function (event) {
            if (event.target === event.currentTarget) close(false);
          }}
        >
          <div
            ref={dialogRef}
            className="panel modal-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={request.description ? descId : undefined}
          >
            <div className="modal-head">
              <h3 id={titleId}>{request.title}</h3>
            </div>
            {request.description ? (
              <div id={descId} className="mini-muted">
                {request.description}
              </div>
            ) : null}
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              {request.mode === "confirm" ? (
                <button
                  ref={cancelBtnRef}
                  type="button"
                  className="button ghost"
                  onClick={function () {
                    close(false);
                  }}
                >
                  {request.cancelLabel}
                </button>
              ) : null}
              <button
                ref={request.mode === "notify" ? cancelBtnRef : undefined}
                type="button"
                className={"button " + (request.tone || "primary")}
                onClick={function () {
                  close(true);
                }}
                autoFocus={request.mode === "notify"}
              >
                {request.mode === "notify" ? "OK" : request.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

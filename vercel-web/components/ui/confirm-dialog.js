"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";

const ConfirmContext = createContext(null);

/**
 * Accessible confirm() replacement.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete?", description: "..." }))) return;
 *
 * Falls back to window.confirm when no provider is mounted (e.g. server-side
 * or component tested in isolation) so existing call sites stay safe.
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (opts) => {
      if (ctx) return ctx.open(opts);
      if (typeof window === "undefined") return Promise.resolve(false);
      return Promise.resolve(window.confirm((opts && opts.description) || (opts && opts.title) || "Confirm?"));
    },
    [ctx]
  );
}

/** Accessible alert helper — non-blocking modal with a single "OK" button. */
export function useNotify() {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (opts) => {
      if (ctx) return ctx.open({ ...opts, mode: "notify" });
      if (typeof window === "undefined") return Promise.resolve(true);
      window.alert((opts && opts.description) || (opts && opts.title) || "");
      return Promise.resolve(true);
    },
    [ctx]
  );
}

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);
  const dialogRef = useRef(null);
  const cancelBtnRef = useRef(null);
  const titleId = useId();
  const descId = useId();

  const close = useCallback((value) => {
    if (resolverRef.current) {
      const fn = resolverRef.current;
      resolverRef.current = null;
      fn(value);
    }
    setRequest(null);
  }, []);

  const open = useCallback((opts) => {
    return new Promise((resolve) => {
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
    const previouslyFocused = typeof document !== "undefined" ? document.activeElement : null;
    cancelBtnRef.current?.focus();

    function handleKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      } else if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
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
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
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
                  onClick={function () { close(false); }}
                >
                  {request.cancelLabel}
                </button>
              ) : null}
              <button
                ref={request.mode === "notify" ? cancelBtnRef : undefined}
                type="button"
                className={"button " + (request.tone || "primary")}
                onClick={function () { close(true); }}
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

"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Download, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResourceItem } from "@/lib/resources";
import { cn } from "@/lib/utils";

type LeadGateProps = {
  resource: ResourceItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: (resource: ResourceItem) => void;
};

/**
 * Soft lead gate before PDF download (§5.6, §8.3).
 * Email is encouraged; user can skip and download anyway (v1).
 */
export function LeadGate({
  resource,
  open,
  onOpenChange,
  onDownload,
}: LeadGateProps) {
  const [email, setEmail] = React.useState("");
  const [whatsapp, setWhatsapp] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [error, setError] = React.useState("");

  function handleOpenChange(next: boolean) {
    if (!next) {
      setStatus("idle");
      setError("");
    }
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resource) return;

    setStatus("loading");
    setError("");

    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          whatsapp: whatsapp.trim() || undefined,
          resourceId: resource.id,
          resourceTitle: resource.title,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok) {
        setStatus("error");
        setError(data.message ?? "Something went wrong.");
        return;
      }
      onDownload(resource);
      handleOpenChange(false);
    } catch {
      setStatus("error");
      setError("Network error. You can still download without submitting.");
    }
  }

  function handleSkip() {
    if (!resource) return;
    onDownload(resource);
    handleOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(100vw-2rem,440px)] -translate-x-1/2 -translate-y-1/2",
            "rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl",
            "focus:outline-none",
          )}
        >
          <Dialog.Title className="font-display text-xl font-bold text-[var(--color-text)]">
            Download free
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
            {resource ? (
              <>
                <span className="font-medium text-[var(--color-text)]">
                  {resource.title}
                </span>
                {" — "}
                {resource.pages} pages · {resource.sizeLabel}. Leave your email
                for new notes (optional WhatsApp for updates). Or skip and
                download now.
              </>
            ) : (
              "Get your PDF."
            )}
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="lead-email"
                className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
              >
                Email
              </label>
              <div className="relative mt-1.5">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]"
                  aria-hidden
                />
                <input
                  id="lead-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] pl-10 pr-4 text-sm"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="lead-whatsapp"
                className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
              >
                WhatsApp <span className="font-normal normal-case">(optional)</span>
              </label>
              <input
                id="lead-whatsapp"
                type="tel"
                name="whatsapp"
                placeholder="+91 98XXXXXXXX"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
              />
            </div>

            {error && (
              <p className="text-sm text-[var(--color-error)]" role="alert">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={status === "loading" || !email.trim()}
              >
                <Download className="size-4" aria-hidden />
                {status === "loading" ? "Saving…" : "Download PDF"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="w-full"
                onClick={handleSkip}
              >
                Skip — download without email
              </Button>
            </div>
          </form>

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close"
              className="absolute right-4 top-4 rounded-full p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
            >
              <X className="size-5" aria-hidden />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

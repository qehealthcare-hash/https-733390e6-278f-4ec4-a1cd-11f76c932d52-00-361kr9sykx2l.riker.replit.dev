"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type SubmitConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  answered: number;
  total: number;
  submitting: boolean;
  onConfirm: () => void;
};

/** Accessible submit confirmation (focus trap, Escape, labelled). */
export function SubmitConfirmDialog({
  open,
  onOpenChange,
  answered,
  total,
  submitting,
  onConfirm,
}: SubmitConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[61] w-[min(100vw-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-6 shadow-2xl focus:outline-none"
          aria-describedby="submit-desc"
        >
          <Dialog.Title
            id="submit-title"
            className="font-display text-xl font-bold text-[var(--color-text)]"
          >
            Submit attempt?
          </Dialog.Title>
          <Dialog.Description
            id="submit-desc"
            className="mt-2 text-sm text-[var(--color-text-muted)]"
          >
            You answered {answered} of {total}. Skipped, review, and not-seen
            questions will be auto-marked unattempted.
          </Dialog.Description>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                Keep attempting
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant="primary"
              onClick={onConfirm}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Submitting…
                </>
              ) : (
                "Submit final"
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

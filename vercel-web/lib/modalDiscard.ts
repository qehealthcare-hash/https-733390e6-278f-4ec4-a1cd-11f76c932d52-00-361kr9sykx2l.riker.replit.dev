import type { ConfirmOptions } from "@/components/ui/confirm-dialog";

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

/** P1-H: confirm before closing a modal when the user entered free text. */
export function confirmDiscardTyped(
  confirm: ConfirmFn,
  hasTypedInput: boolean,
  onDiscard: () => void,
  description = "Closing will lose what you typed in this dialog."
) {
  if (!hasTypedInput) {
    onDiscard();
    return;
  }
  void confirm({
    title: "Discard changes?",
    description,
    confirmLabel: "Discard",
    tone: "danger"
  }).then(function (ok) {
    if (ok) onDiscard();
  });
}

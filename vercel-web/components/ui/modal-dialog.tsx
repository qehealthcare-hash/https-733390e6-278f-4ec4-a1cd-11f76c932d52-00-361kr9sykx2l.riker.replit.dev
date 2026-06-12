"use client";

import { useModalA11y } from "@/hooks/use-modal-a11y";
import type { CSSProperties, ReactNode } from "react";

export type ModalDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Backdrop click and Escape; defaults to {@link onClose}. */
  onRequestClose?: () => void;
  /** When true, Escape and backdrop clicks are ignored. */
  lockClose?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Plain heading rendered with a stable id for aria-labelledby. */
  title?: string;
  /** Custom heading markup — set id on the title element and pass {@link labelledBy}. */
  titleNode?: ReactNode;
  labelledBy?: string;
  ariaLabel?: string;
};

export function ModalDialog({
  open,
  onClose,
  onRequestClose,
  lockClose = false,
  children,
  className = "panel modal-card",
  style,
  title,
  titleNode,
  labelledBy,
  ariaLabel
}: ModalDialogProps) {
  const requestClose = onRequestClose ?? onClose;
  const { dialogRef, titleId: generatedTitleId } = useModalA11y(
    open,
    lockClose ? function () {} : requestClose,
    { disabled: lockClose }
  );
  const headingId = labelledBy ?? generatedTitleId;
  const hasTitle = title != null || titleNode != null;

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={function (event) {
        if (lockClose) return;
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle || labelledBy ? headingId : undefined}
        aria-label={!hasTitle && !labelledBy ? ariaLabel : undefined}
        style={style}
      >
        {title != null ? <h3 id={headingId}>{title}</h3> : null}
        {titleNode}
        {children}
      </div>
    </div>
  );
}

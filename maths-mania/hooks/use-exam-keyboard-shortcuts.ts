"use client";

import * as React from "react";

type Options = {
  enabled: boolean;
  optionCount: number;
  onSelect: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleReview: () => void;
  onClear: () => void;
  onJump?: (index: number) => void;
  totalQuestions: number;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Global exam shortcuts (m19). Does not fire when focus is in form fields.
 */
export function useExamKeyboardShortcuts({
  enabled,
  optionCount,
  onSelect,
  onPrev,
  onNext,
  onToggleReview,
  onClear,
  onJump,
  totalQuestions,
}: Options) {
  const refs = React.useRef({
    onSelect,
    onPrev,
    onNext,
    onToggleReview,
    onClear,
    onJump,
  });
  React.useEffect(() => {
    refs.current = {
      onSelect,
      onPrev,
      onNext,
      onToggleReview,
      onClear,
      onJump,
    };
  });

  React.useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const {
        onSelect: select,
        onPrev: prev,
        onNext: next,
        onToggleReview: review,
        onClear: clear,
        onJump: jump,
      } = refs.current;

      const digit = e.key >= "1" && e.key <= "9" ? Number(e.key) - 1 : -1;
      if (digit >= 0 && digit < optionCount) {
        e.preventDefault();
        select(digit);
        return;
      }

      const letter = e.key.toLowerCase();
      if (letter >= "a" && letter <= "d") {
        const idx = letter.charCodeAt(0) - 97;
        if (idx < optionCount) {
          e.preventDefault();
          select(idx);
          return;
        }
      }

      if (e.key === "[" || (e.key === "ArrowLeft" && e.altKey)) {
        e.preventDefault();
        prev();
        return;
      }
      if (e.key === "]" || (e.key === "ArrowRight" && e.altKey)) {
        e.preventDefault();
        next();
        return;
      }

      if (letter === "r" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        review();
        return;
      }

      if (letter === "c" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        clear();
        return;
      }

      if (jump && e.key >= "0" && e.key <= "9" && e.shiftKey) {
        const q = Number(e.key);
        if (q > 0 && q <= totalQuestions) {
          e.preventDefault();
          jump(q - 1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, optionCount, totalQuestions]);
}

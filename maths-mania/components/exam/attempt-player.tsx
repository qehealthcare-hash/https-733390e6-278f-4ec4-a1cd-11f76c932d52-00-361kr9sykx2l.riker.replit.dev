"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  LogOut,
  Maximize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LatexBlock } from "@/components/math/latex-block";
import { ExamTimer } from "@/components/exam/exam-timer";
import {
  QuestionPalette,
  type PaletteState,
} from "@/components/exam/question-palette";
import { ExamKeyboardHelp } from "@/components/exam/exam-keyboard-help";
import { SubmitConfirmDialog } from "@/components/exam/submit-confirm-dialog";
import { useExamKeyboardShortcuts } from "@/hooks/use-exam-keyboard-shortcuts";
import {
  recordViolationAction,
  saveAnswerAction,
  submitAttemptAction,
} from "@/app/(marketing)/exams/[slug]/attempt/actions";
import type {
  AttemptAnswerSnapshot,
  AttemptQuestion,
} from "@/lib/exams/attempt";
import type { Json, ViolationKind } from "@/lib/database.types";
import { cn } from "@/lib/utils";

type AnswerState = {
  selectedIdx: number | null;
  markedForReview: boolean;
  timeSpentSec: number;
  visited: boolean;
};

type AttemptPlayerProps = {
  examSlug: string;
  examTitle: string;
  attemptId: string;
  questions: AttemptQuestion[];
  initialAnswers: AttemptAnswerSnapshot[];
  endsAtIso: string;
  serverNowIso: string;
};

const SAVE_DEBOUNCE_MS = 400;

export function AttemptPlayer({
  examSlug,
  examTitle,
  attemptId,
  questions,
  initialAnswers,
  endsAtIso,
  serverNowIso,
}: AttemptPlayerProps) {
  const router = useRouter();

  const initialState = React.useMemo<Record<string, AnswerState>>(() => {
    const map: Record<string, AnswerState> = {};
    for (const q of questions) {
      map[q.id] = {
        selectedIdx: null,
        markedForReview: false,
        timeSpentSec: 0,
        visited: false,
      };
    }
    for (const a of initialAnswers) {
      const existing = map[a.question_id];
      if (existing) {
        existing.selectedIdx = a.selected_idx;
        existing.markedForReview = a.marked_for_review;
        existing.timeSpentSec = a.time_spent_sec;
        existing.visited = true;
      }
    }
    if (questions[0]) map[questions[0].id].visited = true;
    return map;
  }, [questions, initialAnswers]);

  const [answers, setAnswers] = React.useState<Record<string, AnswerState>>(
    initialState,
  );
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [needsFullscreen, setNeedsFullscreen] = React.useState(false);

  const current = questions[currentIndex];
  const total = questions.length;

  // Track time spent per question via a stopwatch on currentIndex changes
  const questionEnteredAtRef = React.useRef<number>(0);
  React.useEffect(() => {
    questionEnteredAtRef.current = Date.now();
  }, [currentIndex]);

  const persistTimeSpent = React.useCallback((questionId: string) => {
    const start = questionEnteredAtRef.current;
    if (start <= 0) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
    if (elapsed <= 0) return;
    setAnswers((prev) => {
      const existing = prev[questionId];
      if (!existing) return prev;
      return {
        ...prev,
        [questionId]: {
          ...existing,
          timeSpentSec: existing.timeSpentSec + elapsed,
        },
      };
    });
  }, []);

  // ------------------------------ Autosave -------------------------------
  const pendingSaveRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

  const scheduleSave = React.useCallback(
    (questionId: string) => {
      const existing = pendingSaveRef.current[questionId];
      if (existing) clearTimeout(existing);
      pendingSaveRef.current[questionId] = setTimeout(() => {
        setAnswers((prev) => {
          const state = prev[questionId];
          if (!state) return prev;
          void saveAnswerAction({
            attemptId,
            questionId,
            selectedIdx: state.selectedIdx,
            markedForReview: state.markedForReview,
            timeSpentSec: state.timeSpentSec,
          }).then((res) => {
            if (!res.ok && res.error !== "AUTH_REQUIRED") {
              setError("Could not save your last answer. Retrying…");
            }
          });
          return prev;
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [attemptId],
  );

  // ----------------------------- Navigation ------------------------------
  const goTo = React.useCallback(
    (index: number) => {
      if (index < 0 || index >= total) return;
      if (current) persistTimeSpent(current.id);
      setCurrentIndex(index);
      setAnswers((prev) => {
        const q = questions[index];
        if (!q) return prev;
        const existing = prev[q.id];
        if (!existing || existing.visited) return prev;
        return { ...prev, [q.id]: { ...existing, visited: true } };
      });
    },
    [current, persistTimeSpent, questions, total],
  );

  const next = React.useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const prev = React.useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // ------------------------------ Selection ------------------------------
  const handleSelect = React.useCallback(
    (idx: number) => {
      if (!current) return;
      setAnswers((prevState) => {
        const existing = prevState[current.id];
        if (!existing) return prevState;
        return {
          ...prevState,
          [current.id]: {
            ...existing,
            selectedIdx: existing.selectedIdx === idx ? null : idx,
          },
        };
      });
      scheduleSave(current.id);
    },
    [current, scheduleSave],
  );

  const handleToggleReview = React.useCallback(() => {
    if (!current) return;
    setAnswers((prevState) => {
      const existing = prevState[current.id];
      if (!existing) return prevState;
      return {
        ...prevState,
        [current.id]: {
          ...existing,
          markedForReview: !existing.markedForReview,
        },
      };
    });
    scheduleSave(current.id);
  }, [current, scheduleSave]);

  const handleClear = React.useCallback(() => {
    if (!current) return;
    setAnswers((prevState) => {
      const existing = prevState[current.id];
      if (!existing) return prevState;
      return {
        ...prevState,
        [current.id]: { ...existing, selectedIdx: null },
      };
    });
    scheduleSave(current.id);
  }, [current, scheduleSave]);

  const handleOptionKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!current) return;
      const count = current.options.length;
      if (count === 0) return;
      const selectedIdx = answers[current.id]?.selectedIdx ?? 0;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        handleSelect((selectedIdx + 1) % count);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        handleSelect((selectedIdx - 1 + count) % count);
      }
    },
    [answers, current, handleSelect],
  );

  useExamKeyboardShortcuts({
    enabled: !confirming && !submitting,
    optionCount: current?.options.length ?? 0,
    onSelect: handleSelect,
    onPrev: prev,
    onNext: next,
    onToggleReview: handleToggleReview,
    onClear: handleClear,
    onJump: goTo,
    totalQuestions: total,
  });

  // ------------------------------ Submit ---------------------------------
  const finalizeAndSubmit = React.useCallback(
    async (autoSubmitted: boolean) => {
      if (submitting) return;
      setSubmitting(true);
      if (current) persistTimeSpent(current.id);

      // Flush any pending debounced saves
      for (const id of Object.keys(pendingSaveRef.current)) {
        clearTimeout(pendingSaveRef.current[id]);
      }
      pendingSaveRef.current = {};

      // Snapshot current state to be sure server has the latest
      const snapshot = answers;
      await Promise.all(
        Object.entries(snapshot).map(([questionId, state]) =>
          saveAnswerAction({
            attemptId,
            questionId,
            selectedIdx: state.selectedIdx,
            markedForReview: state.markedForReview,
            timeSpentSec: state.timeSpentSec,
          }),
        ),
      );

      const result = await submitAttemptAction(
        attemptId,
        autoSubmitted,
        examSlug,
      );
      if (result.ok) {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
        } catch {
          /* noop */
        }
        router.push(result.redirectTo);
      } else {
        setSubmitting(false);
        setError("Submission failed. Please try again.");
      }
    },
    [
      answers,
      attemptId,
      current,
      examSlug,
      persistTimeSpent,
      router,
      submitting,
    ],
  );

  const handleAutoSubmit = React.useCallback(() => {
    void finalizeAndSubmit(true);
  }, [finalizeAndSubmit]);

  // --------------------------- Anti-cheat --------------------------------
  const logViolation = React.useCallback(
    (kind: ViolationKind, payload?: Json) => {
      void recordViolationAction({ attemptId, kind, payload }).catch(() => {});
    },
    [attemptId],
  );

  React.useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        logViolation("tab_blur", { ts: new Date().toISOString() });
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      logViolation("contextmenu");
    };
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      logViolation("copy");
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      logViolation("paste");
    };
    const onFullscreenChange = () => {
      const inFs = Boolean(document.fullscreenElement);
      if (!inFs) {
        setNeedsFullscreen(true);
        logViolation("fullscreen_exit");
      } else {
        setNeedsFullscreen(false);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [logViolation]);

  // Warn before leaving (refresh / close)
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const enterFullscreen = React.useCallback(async () => {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
        setNeedsFullscreen(false);
      }
    } catch {
      setNeedsFullscreen(true);
    }
  }, []);

  // ----------------------------- Derived ---------------------------------
  const paletteStates = React.useMemo<PaletteState[]>(
    () =>
      questions.map((q) => {
        const a = answers[q.id];
        if (!a) return "unseen";
        if (a.markedForReview) return "review";
        if (a.selectedIdx !== null) return "answered";
        if (a.visited) return "unanswered";
        return "unseen";
      }),
    [questions, answers],
  );

  const counts = React.useMemo(() => {
    let answered = 0;
    let review = 0;
    let unanswered = 0;
    let unseen = 0;
    for (const s of paletteStates) {
      if (s === "answered") answered += 1;
      else if (s === "review") review += 1;
      else if (s === "unanswered") unanswered += 1;
      else unseen += 1;
    }
    return { answered, review, unanswered, unseen };
  }, [paletteStates]);

  if (!current) {
    return (
      <div className="p-8 text-center text-[var(--color-text-muted)]">
        This exam has no questions yet.
      </div>
    );
  }

  const currentState = answers[current.id];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]"
      role="application"
      aria-label={`${examTitle} exam`}
      aria-describedby="exam-keyboard-help"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-bold text-[var(--color-text)] sm:text-base">
            {examTitle}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            Question {currentIndex + 1} of {total}
            {current.section && ` · ${current.section}`}
            {current.topic && ` · ${current.topic}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExamTimer
            endsAtIso={endsAtIso}
            serverAnchorIso={serverNowIso}
            onExpire={handleAutoSubmit}
          />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={submitting}
            onClick={() => setConfirming(true)}
          >
            <LogOut className="size-4" aria-hidden /> Submit
          </Button>
        </div>
      </header>

      {needsFullscreen && (
        <div
          role="status"
          className="border-b border-[var(--color-warning)]/50 bg-[var(--color-warning-bg)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          <button
            type="button"
            onClick={() => void enterFullscreen()}
            className="inline-flex items-center gap-2 font-semibold"
          >
            <Maximize className="size-4" aria-hidden />
            Re-enter fullscreen — exit was recorded.
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="border-b border-[var(--color-error)]/40 bg-[var(--color-error-bg)] px-4 py-2 text-sm text-[var(--color-error)]"
        >
          {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        <main
          id="exam-question-main"
          className="flex-1 overflow-y-auto px-4 py-6 sm:px-8"
          tabIndex={-1}
        >
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Question {current.position}
            </p>
            <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <LatexBlock math={current.question_latex} display />
            </div>

            <ul
              className="mt-6 space-y-2"
              role="radiogroup"
              aria-label="Answer choices"
              onKeyDown={handleOptionKeyDown}
            >
              {current.options.map((opt, idx) => {
                const isSelected = currentState?.selectedIdx === idx;
                return (
                  <li key={idx}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => handleSelect(idx)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-left text-sm transition",
                        isSelected
                          ? "border-[var(--color-primary-500)] bg-[var(--color-primary-50)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary-300)]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                          isSelected
                            ? "border-[var(--color-primary-500)] bg-[var(--color-primary-500)] text-white"
                            : "border-[var(--color-border)] text-[var(--color-text-muted)]",
                        )}
                      >
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <LatexBlock math={opt} className="flex-1" />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={prev}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="size-4" aria-hidden /> Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={handleToggleReview}
              >
                <Flag className="size-4" aria-hidden />
                {currentState?.markedForReview ? "Unmark review" : "Mark for review"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={handleClear}
                disabled={currentState?.selectedIdx === null}
              >
                Clear
              </Button>
              <div className="ml-auto" />
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={next}
                disabled={currentIndex >= total - 1}
              >
                Save & next <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        </main>

        <aside
          className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 lg:w-72 lg:border-l lg:border-t-0"
          aria-label="Exam sidebar"
        >
          <QuestionPalette
            total={total}
            currentIndex={currentIndex}
            states={paletteStates}
            onJump={goTo}
          />
          <div id="exam-keyboard-help">
            <ExamKeyboardHelp />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
            <div>
              <dt className="font-semibold text-[var(--color-text)]">Answered</dt>
              <dd>{counts.answered}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--color-text)]">For review</dt>
              <dd>{counts.review}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--color-text)]">Skipped</dt>
              <dd>{counts.unanswered}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--color-text)]">Not seen</dt>
              <dd>{counts.unseen}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <SubmitConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        answered={counts.answered}
        total={total}
        submitting={submitting}
        onConfirm={() => void finalizeAndSubmit(false)}
      />
    </div>
  );
}

export function ExamKeyboardHelp() {
  return (
    <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
      <summary className="cursor-pointer font-semibold text-[var(--color-text)]">
        Keyboard shortcuts
      </summary>
      <ul className="mt-2 space-y-1.5 leading-relaxed">
        <li>
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            1
          </kbd>
          –
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            4
          </kbd>{" "}
          or{" "}
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            A
          </kbd>
          –
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            D
          </kbd>{" "}
          — select option
        </li>
        <li>
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            ↑
          </kbd>{" "}
          /{" "}
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            ↓
          </kbd>{" "}
          — move between options
        </li>
        <li>
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            [
          </kbd>{" "}
          /{" "}
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            ]
          </kbd>{" "}
          — previous / next question
        </li>
        <li>
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            R
          </kbd>{" "}
          — mark for review ·{" "}
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            C
          </kbd>{" "}
          — clear selection
        </li>
        <li>
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1 font-mono">
            Shift
          </kbd>
          + digit — jump to question 1–9
        </li>
      </ul>
    </details>
  );
}

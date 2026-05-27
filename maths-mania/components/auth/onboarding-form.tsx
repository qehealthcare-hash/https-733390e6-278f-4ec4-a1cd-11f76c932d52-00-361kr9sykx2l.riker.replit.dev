"use client";

import { useFormState, useFormStatus } from "react-dom";
import { completeOnboarding, type OnboardingState } from "@/app/(auth)/onboarding/actions";
import { CLASS_OR_TARGETS, INDIAN_STATES } from "@/lib/auth/constants";
import { Button } from "@/components/ui/button";

type OnboardingFormProps = {
  next?: string;
  defaultFullName?: string;
  defaultPhone?: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Continue to dashboard"}
    </Button>
  );
}

export function OnboardingForm({
  next = "/dashboard",
  defaultFullName = "",
  defaultPhone,
}: OnboardingFormProps) {
  const [state, formAction] = useFormState<OnboardingState, FormData>(
    completeOnboarding,
    {},
  );

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <p className="text-sm text-[var(--color-error)]" role="alert">
          {state.error}
        </p>
      )}

      <div>
        <label
          htmlFor="fullName"
          className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
        >
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          required
          defaultValue={defaultFullName}
          className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="classOrTarget"
          className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
        >
          I am preparing for
        </label>
        <select
          id="classOrTarget"
          name="classOrTarget"
          required
          defaultValue=""
          className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
        >
          <option value="" disabled>
            Select…
          </option>
          {CLASS_OR_TARGETS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="city"
            className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
          >
            City
          </label>
          <input
            id="city"
            name="city"
            defaultValue=""
            className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="state"
            className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
          >
            State
          </label>
          <select
            id="state"
            name="state"
            defaultValue=""
            className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
          >
            <option value="">Select…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label
          htmlFor="phone"
          className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
        >
          Phone <span className="font-normal normal-case">(optional)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={defaultPhone ?? ""}
          placeholder="+91 98XXXXXXXX"
          className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
        />
      </div>

      <label className="flex items-start gap-3 text-sm text-[var(--color-text-muted)]">
        <input
          type="checkbox"
          name="whatsappOptIn"
          className="mt-1 size-4 rounded border-[var(--color-border)]"
        />
        Send exam reminders on WhatsApp (optional)
      </label>

      <SubmitButton />
    </form>
  );
}

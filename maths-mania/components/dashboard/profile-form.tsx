"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  updateProfileAction,
  type ProfileUpdateState,
} from "@/app/(dashboard)/dashboard/profile/actions";
import { CLASS_OR_TARGETS, INDIAN_STATES } from "@/lib/auth/constants";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/auth/session";

type ProfileFormProps = {
  profile: Profile;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const [state, formAction] = useFormState<ProfileUpdateState, FormData>(
    updateProfileAction,
    {},
  );

  return (
    <form action={formAction} className="mt-8 max-w-lg space-y-4">
      {state.error && (
        <p className="text-sm text-[var(--color-error)]" role="alert">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="text-sm text-[var(--color-success)]" role="status">
          {state.message}
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
          defaultValue={profile.full_name}
          className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="classOrTarget"
          className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
        >
          Preparing for
        </label>
        <select
          id="classOrTarget"
          name="classOrTarget"
          required
          defaultValue={profile.class_or_target ?? ""}
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
            defaultValue={profile.city ?? ""}
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
            defaultValue={profile.state ?? ""}
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
          Phone (optional)
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={profile.phone ?? ""}
          className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
        <input
          type="checkbox"
          name="whatsappOptIn"
          defaultChecked={profile.whatsapp_opt_in}
          className="size-4 rounded border-[var(--color-border)]"
        />
        WhatsApp reminders for live exams
      </label>

      <SubmitButton />
    </form>
  );
}

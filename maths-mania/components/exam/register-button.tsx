"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  registerForExam,
  type RegisterState,
} from "@/app/(marketing)/exams/actions";
import { cn } from "@/lib/utils";

type RegisterButtonProps = {
  examSlug: string;
  alreadyRegistered: boolean;
  registrationOpen: boolean;
  className?: string;
};

const initialState: RegisterState = {};

function SubmitLabel({
  alreadyRegistered,
  registrationOpen,
}: {
  alreadyRegistered: boolean;
  registrationOpen: boolean;
}) {
  const { pending } = useFormStatus();
  if (pending) return <>Reserving seat…</>;
  if (alreadyRegistered) return <>Registered ✓</>;
  if (!registrationOpen) return <>Registration closed</>;
  return <>Register free →</>;
}

export function RegisterButton({
  examSlug,
  alreadyRegistered,
  registrationOpen,
  className,
}: RegisterButtonProps) {
  const router = useRouter();
  const [state, formAction] = useFormState(
    registerForExam.bind(null, examSlug),
    initialState,
  );

  React.useEffect(() => {
    if (state.error === "SIGN_IN_REQUIRED") {
      router.push(`/login?next=${encodeURIComponent(`/exams/${examSlug}`)}`);
    }
  }, [state.error, examSlug, router]);

  const disabled = alreadyRegistered || !registrationOpen;

  return (
    <div className={cn("space-y-2", className)}>
      <form action={formAction}>
        <Button
          type="submit"
          size="lg"
          variant="primary"
          disabled={disabled}
          className="w-full sm:w-auto"
        >
          <SubmitLabel
            alreadyRegistered={alreadyRegistered}
            registrationOpen={registrationOpen}
          />
        </Button>
      </form>
      {state.message && (
        <p className="text-sm font-medium text-[var(--color-success)]" role="status">
          {state.message}
        </p>
      )}
      {state.error && state.error !== "SIGN_IN_REQUIRED" && (
        <p className="text-sm text-[var(--color-error)]" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}

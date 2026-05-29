"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type OtpInputProps = {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
};

/**
 * Six-digit OTP input — single field with monospace tracking for clarity.
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  disabled,
  id = "otp",
}: OtpInputProps) {
  const ref = React.useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, length);
    onChange(digits);
  }

  return (
    <input
      ref={ref}
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern={`[0-9]{${length}}`}
      maxLength={length}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      placeholder={"0".repeat(length)}
      className={cn(
        "h-14 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-bg)] text-center font-mono text-2xl tracking-[0.4em]",
        "focus:border-[var(--color-primary-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-200)]",
        disabled && "opacity-50",
      )}
      aria-label={`${length}-digit verification code`}
    />
  );
}

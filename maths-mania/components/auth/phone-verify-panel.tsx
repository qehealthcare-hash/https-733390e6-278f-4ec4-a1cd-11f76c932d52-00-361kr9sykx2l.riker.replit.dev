"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/auth/otp-input";

type PhoneVerifyPanelProps = {
  phone: string;
  className?: string;
};

export function PhoneVerifyPanel({ phone, className }: PhoneVerifyPanelProps) {
  const [otp, setOtp] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage(null);

    const res = await fetch("/api/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, otp }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      actionLink?: string;
    };

    if (!res.ok || !data.ok || !data.actionLink) {
      setStatus("error");
      setMessage(data.message ?? "Verification failed.");
      return;
    }

    window.location.href = data.actionLink;
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {message && (
        <p className="mb-4 text-sm text-[var(--color-error)]" role="alert">
          {message}
        </p>
      )}
      <OtpInput value={otp} onChange={setOtp} disabled={status === "loading"} />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="mt-4 w-full"
        disabled={status === "loading" || otp.length !== 6}
      >
        {status === "loading" && (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        )}
        Verify & continue
      </Button>
    </form>
  );
}

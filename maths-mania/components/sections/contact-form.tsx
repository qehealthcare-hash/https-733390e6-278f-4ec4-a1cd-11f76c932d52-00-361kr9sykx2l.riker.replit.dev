"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOPICS = [
  { value: "general", label: "General question" },
  { value: "exam", label: "Live exam / registration" },
  { value: "school", label: "School maths" },
  { value: "banking", label: "Banking / SSC prep" },
  { value: "partnership", label: "Partnership / media" },
] as const;

export function ContactForm() {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [topic, setTopic] = React.useState<string>(TOPICS[0].value);
  const [message, setMessage] = React.useState("");
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [feedback, setFeedback] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setFeedback("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          topic,
          message: message.trim(),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };

      if (!res.ok) {
        setStatus("error");
        setFeedback(data.message ?? "Something went wrong. Try again.");
        return;
      }

      setStatus("success");
      setFeedback(
        "Message sent. We usually reply within 24 hours on working days.",
      );
      setName("");
      setEmail("");
      setTopic(TOPICS[0].value);
      setMessage("");
    } catch {
      setStatus("error");
      setFeedback("Network error. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="contact-name"
            className="text-sm font-medium text-[var(--color-text)]"
          >
            Name
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={status === "loading"}
            className={cn(
              "mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)]",
              "bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
            )}
          />
        </div>
        <div>
          <label
            htmlFor="contact-email"
            className="text-sm font-medium text-[var(--color-text)]"
          >
            Email
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "loading"}
            className={cn(
              "mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)]",
              "bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
            )}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="contact-topic"
          className="text-sm font-medium text-[var(--color-text)]"
        >
          Topic
        </label>
        <select
          id="contact-topic"
          name="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={status === "loading"}
          className={cn(
            "mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)]",
            "bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
          )}
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="contact-message"
          className="text-sm font-medium text-[var(--color-text)]"
        >
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={status === "loading"}
          className={cn(
            "mt-1.5 w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border-strong)]",
            "bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
          )}
        />
      </div>

      <Button type="submit" variant="primary" disabled={status === "loading"}>
        {status === "loading" ? "Sending…" : "Send message"}
      </Button>

      {feedback && (
        <p
          role="status"
          className={cn(
            "text-sm",
            status === "success"
              ? "text-[var(--color-success-600)]"
              : "text-[var(--color-danger-600)]",
          )}
        >
          {feedback}
        </p>
      )}
    </form>
  );
}

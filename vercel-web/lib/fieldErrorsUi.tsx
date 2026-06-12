/**
 * Inline field-level validation errors (P2-9) — pairs `aria-invalid` /
 * `aria-describedby` on inputs with an adjacent error node.
 */

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react";

export type FieldErrorsMap = Record<string, string[]>;

export interface ParsedFieldErrors {
  fields: FieldErrorsMap;
  form: string[];
}

export function parseValidationFieldErrors(err: unknown): ParsedFieldErrors | null {
  if (!err || typeof err !== "object") return null;
  if ((err as { code?: string }).code !== "validation_error") return null;
  return parseValidationDetails((err as { details?: unknown }).details);
}

export function parseValidationDetails(details: unknown): ParsedFieldErrors | null {
  if (!details || typeof details !== "object") return null;
  const d = details as {
    fieldErrors?: Record<string, string[] | undefined>;
    formErrors?: string[];
  };
  const fields: FieldErrorsMap = {};
  for (const [key, msgs] of Object.entries(d.fieldErrors || {})) {
    if (!msgs?.length) continue;
    fields[key] = msgs.filter(Boolean) as string[];
  }
  const form = (d.formErrors || []).filter(Boolean) as string[];
  if (!Object.keys(fields).length && !form.length) return null;
  return { fields, form };
}

export function fieldErrorElementId(formPrefix: string, fieldName: string): string {
  const safe = fieldName.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${formPrefix}-field-error-${safe}`;
}

export function collectFieldMessages(
  fields: FieldErrorsMap | undefined,
  fieldName: string,
  aliasKeys: string[] = []
): string[] {
  const keys = [fieldName, ...aliasKeys];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    for (const msg of fields?.[key] || []) {
      const text = String(msg || "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

export function fieldInputAriaProps(
  formPrefix: string,
  fieldName: string,
  fields: FieldErrorsMap | undefined,
  aliasKeys: string[] = []
): {
  messages: string[];
  errorId: string;
  inputProps: {
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  };
} {
  const messages = collectFieldMessages(fields, fieldName, aliasKeys);
  const has = messages.length > 0;
  const errorId = fieldErrorElementId(formPrefix, fieldName);
  return {
    messages,
    errorId,
    inputProps: has
      ? { "aria-invalid": true, "aria-describedby": errorId }
      : {}
  };
}

export function FieldInlineError({
  id,
  messages
}: {
  id: string;
  messages: string[];
}) {
  if (!messages.length) return null;
  return (
    <small id={id} className="error-text" role="alert" style={{ display: "block", marginTop: 4 }}>
      {messages.join(", ")}
    </small>
  );
}

type ValidatedControlProps = {
  formPrefix: string;
  name: string;
  aliasKeys?: string[];
  fieldErrors?: FieldErrorsMap | null;
};

export function ValidatedInput({
  formPrefix,
  name,
  aliasKeys = [],
  fieldErrors,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & ValidatedControlProps) {
  const fe = fieldInputAriaProps(formPrefix, name, fieldErrors ?? undefined, aliasKeys);
  return (
    <>
      <input {...rest} {...fe.inputProps} />
      <FieldInlineError id={fe.errorId} messages={fe.messages} />
    </>
  );
}

export function ValidatedSelect({
  formPrefix,
  name,
  aliasKeys = [],
  fieldErrors,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & ValidatedControlProps & { children?: ReactNode }) {
  const fe = fieldInputAriaProps(formPrefix, name, fieldErrors ?? undefined, aliasKeys);
  return (
    <>
      <select {...rest} {...fe.inputProps}>
        {children}
      </select>
      <FieldInlineError id={fe.errorId} messages={fe.messages} />
    </>
  );
}

export function ValidatedTextarea({
  formPrefix,
  name,
  aliasKeys = [],
  fieldErrors,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & ValidatedControlProps) {
  const fe = fieldInputAriaProps(formPrefix, name, fieldErrors ?? undefined, aliasKeys);
  return (
    <>
      <textarea {...rest} {...fe.inputProps} />
      <FieldInlineError id={fe.errorId} messages={fe.messages} />
    </>
  );
}

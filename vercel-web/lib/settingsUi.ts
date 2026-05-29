/**
 * Settings module UI helpers (M11 Pass D).
 */

export interface SettingsKeyDef {
  key: string;
  label: string;
  textarea?: boolean;
  json?: boolean;
}

export const SETTINGS_KNOWN_KEYS: readonly SettingsKeyDef[] = [
  { key: "signatoryName", label: "Signatory name" },
  { key: "signatoryTitle", label: "Signatory title" },
  { key: "signature", label: "Signature image URL" },
  { key: "seal", label: "Company seal image URL" },
  {
    key: "services",
    label: "Service catalogue (JSON array)",
    textarea: true,
    json: true
  },
  {
    key: "shiftRates",
    label: 'Shift rates (JSON, e.g. {"DAY":700,"NIGHT":900})',
    textarea: true,
    json: true
  },
  { key: "company", label: "Company info (JSON)", textarea: true, json: true }
];

export function settingsValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseSettingsValue(input: string, isJson: boolean): unknown {
  if (input === "") return null;
  if (!isJson) return input;
  return JSON.parse(input);
}

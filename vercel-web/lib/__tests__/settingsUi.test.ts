import { describe, expect, it } from "vitest";
import {
  SETTINGS_KNOWN_KEYS,
  parseSettingsValue,
  settingsValueToString
} from "@/lib/settingsUi";

describe("settingsUi", () => {
  it("SETTINGS_KNOWN_KEYS includes signatory fields", () => {
    expect(SETTINGS_KNOWN_KEYS.some((k) => k.key === "signatoryName")).toBe(true);
  });

  it("settingsValueToString stringifies objects", () => {
    expect(settingsValueToString({ a: 1 })).toContain('"a"');
  });

  it("parseSettingsValue validates JSON keys", () => {
    expect(parseSettingsValue('{"DAY":700}', true)).toEqual({ DAY: 700 });
    expect(() => parseSettingsValue("{bad", true)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  canonicalSupabaseUrl,
  projectRefFromSupabaseKey,
  resolveSupabaseUrl
} from "@/lib/supabase/resolveSupabaseUrl";

/** Sample anon JWT from .env.example shape (ref = hkyjxdmkqkydnrafhpgn). */
const SAMPLE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhreWp4ZG1rcWt5ZG5yYWZocGduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NTI1MTcsImV4cCI6MjA5MjUyODUxN30.x";

describe("resolveSupabaseUrl", () => {
  it("reads project ref from anon key", () => {
    expect(projectRefFromSupabaseKey(SAMPLE_ANON)).toBe("hkyjxdmkqkydnrafhpgn");
  });

  it("corrects known typo host to JWT ref", () => {
    const bad = "https://hkyjxdmkqydnrafhpgn.supabase.co";
    const result = resolveSupabaseUrl(bad, SAMPLE_ANON);
    expect(result.corrected).toBe(true);
    expect(result.url).toBe(canonicalSupabaseUrl("hkyjxdmkqkydnrafhpgn"));
  });

  it("keeps URL when host matches ref", () => {
    const good = "https://hkyjxdmkqkydnrafhpgn.supabase.co";
    const result = resolveSupabaseUrl(good, SAMPLE_ANON);
    expect(result.corrected).toBe(false);
    expect(result.url).toBe(good);
  });
});

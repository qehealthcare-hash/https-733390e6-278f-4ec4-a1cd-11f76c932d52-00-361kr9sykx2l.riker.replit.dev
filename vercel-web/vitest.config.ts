import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["src/test/vitest.setup.ts"],
    // M3-H3: include `lib/` so the period helper test (and any future
    // co-located lib-level test) gets picked up. Tests under `src/` stay
    // the dominant convention; `lib/` is opt-in by living next to the
    // file it exercises (e.g. `lib/__tests__/period.test.ts`).
    include: ["src/**/*.test.ts", "lib/**/*.test.ts"],
    env: {
      API_AUDIT_DISABLED: "true",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      SUPABASE_ANON_KEY: "test-anon-key",
      WHATSAPP_VERIFY_TOKEN: "test-verify",
      WHATSAPP_APP_SECRET: "test-secret"
    }
  },
  resolve: {
    alias: {
      "@/lib/api": path.resolve(__dirname, "lib/api"),
      "@/lib": path.resolve(__dirname, "lib"),
      "@/src": path.resolve(__dirname, "src"),
      "@/app": path.resolve(__dirname, "app"),
      "@/database": path.resolve(__dirname, "src/database"),
      "@/services": path.resolve(__dirname, "src/services"),
      "@/business": path.resolve(__dirname, "src/business"),
      "@/validation": path.resolve(__dirname, "src/validation"),
      "@/utils": path.resolve(__dirname, "src/utils"),
      "@/types": path.resolve(__dirname, "src/types"),
      "@/test": path.resolve(__dirname, "src/test")
    }
  }
});

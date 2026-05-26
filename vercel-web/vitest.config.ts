import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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

import { test, expect } from "@playwright/test";

/**
 * API-only smoke — no browser required (runs in CI / sandbox).
 */
test.describe("API smoke", () => {
  test("health returns ok envelope", async ({ request }) => {
    test.setTimeout(90_000);
    const res = await request.get("/api/v1/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeTruthy();
  });

  test("reports dashboard requires auth", async ({ request }) => {
    const res = await request.get("/api/v1/reports/dashboard?period=2026-05");
    expect(res.status()).toBe(401);
  });

  test("report summary endpoints require auth", async ({ request }) => {
    const paths = [
      "/api/v1/reports/inquiries?period=2026-05",
      "/api/v1/reports/patients?period=2026-05",
      "/api/v1/reports/attendance?period=2026-05",
      "/api/v1/reports/billings?period=2026-05"
    ];
    for (const path of paths) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
    }
  });
});

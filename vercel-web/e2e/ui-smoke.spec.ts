import { test, expect } from "@playwright/test";

/**
 * Browser smoke — run locally after `npx playwright install chromium`.
 * Skipped when PLAYWRIGHT_SKIP_UI=1 (CI agents without a working Chromium).
 */
test.describe("UI smoke", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_SKIP_UI), "PLAYWRIGHT_SKIP_UI is set");

  test("login page renders email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("home redirects to dashboard or login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/(dashboard|login)/, { timeout: 20_000 });
    expect(page.url()).toMatch(/\/(dashboard|login)/);
  });
});

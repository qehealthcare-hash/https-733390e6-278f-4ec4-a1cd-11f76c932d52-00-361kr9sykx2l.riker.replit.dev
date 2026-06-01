import { test, expect } from "@playwright/test";

/**
 * Mobile viewport smoke (iPhone 13 ≈ 390×844).
 *
 * Guards the layout contracts the audit flagged as P3 — no automated mobile
 * test. Runs under the `mobile` Playwright project (see playwright.config.ts);
 * is skipped when `PLAYWRIGHT_SKIP_UI=1` so headless CI agents without a
 * working Chromium do not fail the suite.
 */

test.describe("Mobile viewport smoke", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_SKIP_UI), "PLAYWRIGHT_SKIP_UI is set");

  test("login form is reachable without horizontal scrolling on a phone", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

    // No horizontal overflow: scrollWidth should not exceed the viewport
    // width. Catches regressions in mobile.css / app-shell paddings.
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return { scroll: root.scrollWidth, client: root.clientWidth };
    });
    expect(overflow.scroll, "page overflows horizontally").toBeLessThanOrEqual(
      overflow.client + 1
    );
  });

  test("viewport meta tag is present so phones do not render at 1024px", async ({ page }) => {
    await page.goto("/login");
    const meta = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(meta || "").toMatch(/width=device-width/);
  });

  test("skip-link is rendered (keyboard accessibility)", async ({ page }) => {
    await page.goto("/login");
    const skip = page.getByRole("link", { name: /skip to main content/i });
    await expect(skip).toHaveCount(1);
  });
});

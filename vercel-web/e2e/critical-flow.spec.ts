import { test, expect } from "@playwright/test";

const email = process.env.E2E_EMAIL || "";
const password = process.env.E2E_PASSWORD || "";
const hasCreds = Boolean(email && password);

test.describe("Authenticated critical paths", () => {
  test.skip(!hasCreds, "Set E2E_EMAIL and E2E_PASSWORD to run signed-in flows");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  });

  test("dashboard loads KPI shell", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });
  });

  test("patients registry loads", async ({ page }) => {
    await page.goto("/patients");
    await expect(page.getByRole("heading", { name: /patients/i })).toBeVisible({ timeout: 15_000 });
  });

  test("reports overview tab loads server totals", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /inquiries/i }).click();
    await expect(page.getByText(/total inquiries|inquiry/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("billings module reachable", async ({ page }) => {
    await page.goto("/billings");
    await expect(page.getByRole("heading", { name: /billing/i })).toBeVisible({ timeout: 15_000 });
  });

  test("payouts shell loads", async ({ page }) => {
    await page.goto("/payouts");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toContainText("Application error");
  });
});

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "https://crm.hominalhealthcare.com";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Mobile viewport project — iPhone 13 dimensions on Chromium so CI only
    // needs `playwright install chromium` (WebKit is not required).
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: devices["iPhone 13"].viewport,
        userAgent: devices["iPhone 13"].userAgent,
        deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
        isMobile: true,
        hasTouch: true
      }
    }
  ]
});

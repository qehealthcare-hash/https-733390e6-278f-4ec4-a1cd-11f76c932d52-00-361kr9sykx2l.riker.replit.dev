import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 10_000,
    reporters: ["verbose"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } }
  }
});

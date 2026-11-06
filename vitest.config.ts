import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text-summary", "text"],
      // Floors are the measured coverage (2026-10-28) rounded down. Raise
      // them as coverage grows; never lower them to land a change.
      thresholds: {
        lines: 76,
        functions: 79,
        branches: 61,
        statements: 75,
      },
    },
  },
});

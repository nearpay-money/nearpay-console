import { defineConfig } from "vitest/config";

// Unit tests run in Node against the pure modules (API client, session/expiry, permissions, router,
// formatting, assets, reconciliation maths + CSV, review checks). UI flows are covered by the
// mock-backed Playwright suite (test/e2e). Coverage gate (foundations §16): ≥ 90% branches and lines
// on src/lib (hooks and the WebAuthn wrapper are exercised end to end instead).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["test/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/hooks.ts", "src/lib/passkeys.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { branches: 90, lines: 90 },
    },
  },
});

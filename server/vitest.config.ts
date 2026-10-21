import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // End-to-end files share testnet accounts, so they run one after another.
    fileParallelism: false,
    // End-to-end tests wait for real testnet transactions, a few seconds each.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});

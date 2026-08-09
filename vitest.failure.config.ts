import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/failure-probe/**/*.test.ts"],
  },
});

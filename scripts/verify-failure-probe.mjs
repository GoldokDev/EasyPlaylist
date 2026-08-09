import { run } from "./process.mjs";

const status = run(process.execPath, [
  "node_modules/vitest/vitest.mjs",
  "run",
  "--config",
  "vitest.failure.config.ts",
]);

if (status === 0) {
  throw new Error("The deliberately red test unexpectedly passed");
}

process.stdout.write(
  `Failure probe returned the expected non-zero code (${status}).\n`,
);

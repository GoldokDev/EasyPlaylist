import { getAvailablePort, run, waitForPort } from "./process.mjs";

const projectName = `easyplaylist-pg-tests-${process.pid}`;
const databasePort = await getAvailablePort(25_432);
const composeEnvironment = {
  ...process.env,
  DB_PORT: String(databasePort),
  POSTGRES_DB: "easyplaylist_test",
  POSTGRES_PASSWORD: "fixture-only",
  POSTGRES_USER: "easyplaylist_test",
};
const testEnvironment = {
  ...composeEnvironment,
  TEST_DATABASE_URL: `postgresql://easyplaylist_test:fixture-only@127.0.0.1:${databasePort}/easyplaylist_test`,
};

let status = 1;

try {
  status = run(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.test.yaml",
      "-p",
      projectName,
      "up",
      "-d",
      "--wait",
      "db",
    ],
    { env: composeEnvironment },
  );

  if (status === 0) {
    await waitForPort(databasePort);
    status = run(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "--config",
        "vitest.integration.config.ts",
      ],
      { env: testEnvironment },
    );
  }
} finally {
  const cleanupStatus = run(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-f",
      "compose.test.yaml",
      "-p",
      projectName,
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { env: composeEnvironment },
  );

  if (status === 0 && cleanupStatus !== 0) {
    status = cleanupStatus;
  }
}

process.exitCode = status;

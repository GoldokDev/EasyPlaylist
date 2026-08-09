import { getAvailablePort, run, waitForPort } from "./process.mjs";

const projectName = `easyplaylist-e2e-${process.pid}`;
const [webPort, apiPort, databasePort] = await Promise.all([
  getAvailablePort(25_173),
  getAvailablePort(23_000),
  getAvailablePort(25_433),
]);
const composeEnvironment = {
  ...process.env,
  API_PORT: String(apiPort),
  DB_PORT: String(databasePort),
  POSTGRES_DB: "easyplaylist_e2e",
  POSTGRES_PASSWORD: "e2e-only",
  POSTGRES_USER: "easyplaylist_e2e",
  WEB_PORT: String(webPort),
  YOUTUBE_API_KEY: "",
};
const testEnvironment = {
  ...composeEnvironment,
  PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
};

let status = 1;

try {
  status = run(
    "docker",
    ["compose", "-p", projectName, "up", "-d", "--build", "--wait"],
    { env: composeEnvironment },
  );

  if (status === 0) {
    await waitForPort(webPort);
    status = run(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test"],
      { env: testEnvironment },
    );
  }

  run("docker", ["compose", "-p", projectName, "logs", "--no-color"], {
    env: composeEnvironment,
  });
} finally {
  const cleanupStatus = run(
    "docker",
    ["compose", "-p", projectName, "down", "--volumes", "--remove-orphans"],
    { env: composeEnvironment },
  );

  if (status === 0 && cleanupStatus !== 0) {
    status = cleanupStatus;
  }
}

process.exitCode = status;

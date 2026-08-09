import { spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";

export async function getAvailablePort(preferredPort) {
  return await new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(preferredPort ?? 0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a local port"));
        return;
      }

      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

export async function waitForPort(port, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });

      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (connected) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Port ${port} did not become reachable within ${timeoutMilliseconds}ms`,
  );
}

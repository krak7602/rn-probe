/**
 * Spawn the daemon as a detached background process and wait for its socket
 * to appear (up to 5 seconds).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SOCKET_PATH } from "./ipc.js";

const DAEMON_ENTRY = path.resolve(
  fileURLToPath(import.meta.url),
  "../../dist/daemon/index.js"
);

export async function ensureDaemon(): Promise<void> {
  if (existsSync(SOCKET_PATH)) return;

  const child = spawn(process.execPath, [DAEMON_ENTRY], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Poll for socket appearance
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(SOCKET_PATH)) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error("Daemon did not start within 5 seconds.");
}

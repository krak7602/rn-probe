import net from "node:net";
import { createInterface } from "node:readline";
import { v4 as uuidv4 } from "uuid";

export const SOCKET_PATH = "/tmp/rn-probe.sock";

// ── Protocol types ────────────────────────────────────────────────────────────

export interface Request {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface Response {
  id: string;
  result: unknown;
}

export interface ErrorResponse {
  id: string;
  error: { message: string };
}

export type AnyResponse = Response | ErrorResponse;

export function isError(r: AnyResponse): r is ErrorResponse {
  return "error" in r;
}

// ── IPC client ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Send a single request to the daemon and return the result.
 * Returns null if the socket does not exist or connection is refused —
 * the caller should spawn the daemon and retry.
 */
export async function sendRequest(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const connected = await isSocketAlive();
  if (!connected) return null;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`IPC timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    socket.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(null); // treat as daemon not running
      }
    });

    const rl = createInterface({ input: socket, crlfDelay: Infinity });

    rl.on("line", (line) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      socket.destroy();

      const response: AnyResponse = JSON.parse(line);
      if (isError(response)) {
        reject(new Error(response.error.message));
      } else {
        resolve(response.result);
      }
    });

    socket.on("connect", () => {
      const req: Request = { id: uuidv4(), method, params };
      socket.write(JSON.stringify(req) + "\n");
    });
  });
}

// ── Socket health check ───────────────────────────────────────────────────────

export async function isSocketAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(SOCKET_PATH);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

// ── Stale socket cleanup ──────────────────────────────────────────────────────

import fs from "node:fs";

export function removeStaleSocket(): void {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {
    // already gone — fine
  }
}

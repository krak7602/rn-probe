import http from "node:http";
import { state } from "./state.js";

// ── Types from Metro's /status response ───────────────────────────────────────

interface MetroStatus {
  bundleStatus?: string;
  type?: string;
}

// ── Ring buffer for Metro stdout ──────────────────────────────────────────────

const LOG_BUFFER_SIZE = 500;
const logBuffer: string[] = [];

export function appendMetroLog(line: string) {
  if (logBuffer.length >= LOG_BUFFER_SIZE) logBuffer.shift();
  logBuffer.push(line);
}

// ── MetroBridge ───────────────────────────────────────────────────────────────

export class MetroBridge {
  private baseUrl = "http://localhost:8081";
  private metroProcess: import("node:child_process").ChildProcess | null = null;

  connect(metroUrl: string) {
    this.baseUrl = metroUrl;
    state.metroConnected = true;
  }

  disconnect() {
    state.metroConnected = false;
  }

  // ── GET /status ─────────────────────────────────────────────────────────────

  async getBundleStatus(): Promise<string> {
    const data = await this.get("/status").catch(() => null);
    if (data === null) {
      throw new Error(`Metro not reachable at ${this.baseUrl}. Is your dev server running?`);
    }
    const parsed = JSON.parse(data) as MetroStatus;
    const lines: string[] = [];
    lines.push(`Metro URL:    ${this.baseUrl}`);
    lines.push(`Bundle type:  ${parsed.type ?? "unknown"}`);
    lines.push(`Status:       ${parsed.bundleStatus ?? JSON.stringify(parsed)}`);
    return lines.join("\n");
  }

  // ── Errors ──────────────────────────────────────────────────────────────────

  async getErrors(cdpErrors = ""): Promise<string> {
    const data = await this.get("/status").catch(() => null);
    if (data === null) {
      throw new Error(`Metro not reachable at ${this.baseUrl}. Is your dev server running?`);
    }

    const parts: string[] = [];
    if (cdpErrors) parts.push(cdpErrors);

    // Metro /status may return plain text ("packager-status:running") or JSON
    try {
      const parsed = JSON.parse(data) as MetroStatus;
      if (parsed.type === "BundleTransformError") {
        parts.push(`Build Error:\n${JSON.stringify(parsed, null, 2)}`);
      }
    } catch {
      // Plain-text status — not a build error
    }

    return parts.length > 0 ? parts.join("\n\n") : "No errors.";
  }

  // ── Logs ────────────────────────────────────────────────────────────────────

  getLogs(lines: number): string {
    const tail = logBuffer.slice(-lines);
    return tail.length > 0 ? tail.join("\n") : "(no Metro logs captured yet)";
  }

  // ── Reload ──────────────────────────────────────────────────────────────────

  async reload(): Promise<string> {
    // New arch Expo dev build: use Metro message WebSocket
    const sent = await this.sendDevCommand("reload");
    if (!sent) {
      // Legacy fallback: POST /reload
      await this.post("/reload", "").catch(() => {});
    }
    return "Reload triggered.";
  }

  private sendDevCommand(name: string): Promise<boolean> {
    return new Promise((resolve) => {
      const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/message";
      let ws: import("ws").WebSocket;
      try {
        // Dynamic import to avoid top-level ws dependency in metro.ts
        import("ws").then(({ default: WebSocket }) => {
          ws = new WebSocket(wsUrl);
          ws.on("open", () => {
            ws.send(JSON.stringify({ method: "sendDevCommand", params: { name } }));
            setTimeout(() => { ws.close(); resolve(true); }, 200);
          });
          ws.on("error", () => resolve(false));
        }).catch(() => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  // ── Restart Metro ───────────────────────────────────────────────────────────

  async restart(): Promise<string> {
    if (this.metroProcess) {
      this.metroProcess.kill("SIGTERM");
      this.metroProcess = null;
    }

    const { execa } = await import("execa");
    const child = execa("npx", ["react-native", "start", "--reset-cache"], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) appendMetroLog(line);
      }
    });

    this.metroProcess = child as unknown as import("node:child_process").ChildProcess;

    // Wait up to 20s for Metro to be ready
    await this.waitForMetro(20_000);
    return "Metro restarted.";
  }

  private async waitForMetro(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.get("/status").then(() => true).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Metro did not become ready within timeout.");
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────────

  private get(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      http.get(`${this.baseUrl}${path}`, (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => resolve(data));
      }).on("error", reject);
    });
  }

  private post(path: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${path}`);
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST" }, (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

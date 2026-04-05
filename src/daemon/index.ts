import net from "node:net";
import fs from "node:fs";
import { SOCKET_PATH, Request, Response, ErrorResponse } from "../ipc.js";
import { state } from "./state.js";
import { MetroBridge } from "./metro.js";
import { DevToolsBridge } from "./devtools.js";
import { SimulatorBridge } from "./simulator.js";
import { CDPBridge } from "./cdp.js";

// ── Handler registry ──────────────────────────────────────────────────────────

type Handler = (params: Record<string, unknown>) => Promise<unknown>;
const handlers = new Map<string, Handler>();

function register(method: string, fn: Handler) {
  handlers.set(method, fn);
}

// ── Bridges ───────────────────────────────────────────────────────────────────

export const metro = new MetroBridge();
export const devtools = new DevToolsBridge();
export const simulator = new SimulatorBridge();
let cdp: CDPBridge | null = null;

// ── Lifecycle handlers ────────────────────────────────────────────────────────

register("open", async (params) => {
  if (params.metroUrl) state.metroUrl = params.metroUrl as string;
  if (params.expoMode) state.expoMode = params.expoMode as typeof state.expoMode;
  if (params.platform) state.platform = params.platform as typeof state.platform;
  if (params.targetUdid) state.targetUdid = params.targetUdid as string;

  metro.connect(state.metroUrl);

  const forceNewArch = params.forceNewArch === true;

  // Auto-detect: probe /json; if targets found use CDP, else fall back to legacy port 8097
  cdp = new CDPBridge(state.metroUrl);
  const cdpConnected = await cdp.connect(forceNewArch);

  if (cdpConnected) {
    state.arch = "new";
    state.devtoolsConnected = true;
    devtools.useCDP(cdp);
  } else {
    cdp = null;
    state.arch = "legacy";
    await devtools.connect();
  }

  const archMsg = state.arch === "new"
    ? "Connected via CDP (new architecture)"
    : "Connected via DevTools (legacy architecture)";

  return {
    metroUrl: state.metroUrl,
    expoMode: state.expoMode,
    platform: state.platform,
    arch: state.arch,
    metroConnected: state.metroConnected,
    devtoolsConnected: state.devtoolsConnected,
    message: archMsg,
  };
});

register("close", async () => {
  metro.disconnect();
  devtools.disconnect();
  cleanup();
  process.exit(0);
});

// ── Metro handlers ────────────────────────────────────────────────────────────

register("bundle-status", async () => metro.getBundleStatus());
register("errors", async () => metro.getErrors(devtools.getErrors()));
register("logs", async (p) => metro.getLogs(Number(p.lines ?? 50)));
register("reload", async () => metro.reload());
register("restart-metro", async () => metro.restart());

// ── DevTools handlers ─────────────────────────────────────────────────────────

register("tree", async () => devtools.getTree());
register("inspect", async (p) => devtools.inspect(p.id as string));
register("find", async (p) => devtools.find(p.name as string));
register("eval", async (p) => devtools.evaluate(p.script as string));
register("network", async (p) => devtools.network(p.idx !== undefined ? Number(p.idx) : undefined));
register("logs-perf", async () => devtools.getPerfMetrics());

// ── Simulator handlers ────────────────────────────────────────────────────────

register("screenshot", async (p) => simulator.screenshot(p.udid as string | undefined));
register("tap", async (p) => simulator.tap(Number(p.x), Number(p.y), p.udid as string | undefined));
register("swipe", async (p) =>
  simulator.swipe(Number(p.x1), Number(p.y1), Number(p.x2), Number(p.y2), p.udid as string | undefined)
);
register("viewport", async (p) => simulator.viewport(p.size as string | undefined, p.udid as string | undefined));
register("goto", async (p) =>
  simulator.goto(p.screen as string, state.expoMode, p.scheme as string | undefined, p.udid as string | undefined)
);
register("back", async (p) => simulator.back(p.udid as string | undefined));
register("logs-native", async (p) =>
  simulator.logsNative(state.bundleId ?? "com.example.app", p.udid as string | undefined)
);
register("type", async (p) => simulator.type(p.text as string, p.udid as string | undefined));

// ── IPC server ────────────────────────────────────────────────────────────────

function cleanup() {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {
    // already gone
  }
}

process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);
process.on("uncaughtException", (err) => {
  console.error("[daemon] uncaught:", err);
  cleanup();
  process.exit(1);
});

// Remove stale socket from a previous crash
cleanup();

const server = net.createServer((socket) => {
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      handleRequest(socket, line);
    }
  });

  socket.on("error", () => socket.destroy());
});

async function handleRequest(socket: net.Socket, raw: string) {
  let req: Request;
  try {
    req = JSON.parse(raw);
  } catch {
    return;
  }

  const handler = handlers.get(req.method);
  if (!handler) {
    const err: ErrorResponse = { id: req.id, error: { message: `Unknown method: ${req.method}` } };
    socket.write(JSON.stringify(err) + "\n");
    return;
  }

  try {
    const result = await handler(req.params ?? {});
    const res: Response = { id: req.id, result };
    socket.write(JSON.stringify(res) + "\n");
  } catch (e) {
    const err: ErrorResponse = { id: req.id, error: { message: (e as Error).message } };
    socket.write(JSON.stringify(err) + "\n");
  }
}

server.listen(SOCKET_PATH, () => {
  console.log(`[daemon] listening on ${SOCKET_PATH}`);
});

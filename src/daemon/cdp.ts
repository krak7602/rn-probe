import http from "node:http";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";

const METRO_JSON_PATH = "/json";
const REQUEST_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 1_000;
const TARGET_WAIT_MS = 10_000;
const TARGET_POLL_INTERVAL_MS = 500;
const ERROR_BUFFER_SIZE = 50;

// ── CDP protocol types ────────────────────────────────────────────────────────

interface CDPTarget {
  id: string;
  title: string;
  type: string;
  webSocketDebuggerUrl: string;
}

interface CDPRequest {
  id: string;
  method: string;
  params?: unknown;
}

interface CDPResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface CDPEvent {
  method: string;
  params?: unknown;
}

interface RuntimeException {
  timestamp: number;
  exceptionDetails: {
    text: string;
    exception?: { description?: string };
    stackTrace?: { callFrames: Array<{ functionName: string; url: string; lineNumber: number }> };
  };
}

interface NetworkRequest {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  requestStartTime?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
}

interface ComponentNode {
  id: number;
  displayName: string | null;
  children: number[];
  props?: Record<string, unknown>;
  state?: unknown;
  hooks?: Array<{ name: string; value: unknown }>;
  source?: { fileName: string; lineNumber: number } | null;
}

// ── CDPBridge ─────────────────────────────────────────────────────────────────

export class CDPBridge {
  private metroUrl: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private pendingRequests = new Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  private errorBuffer: RuntimeException[] = [];
  private networkLog: Map<string, NetworkRequest> = new Map();

  constructor(metroUrl: string) {
    this.metroUrl = metroUrl;
  }

  get isConnected() { return this.connected; }

  // ── 1.2 Target discovery ──────────────────────────────────────────────────

  async discoverTarget(force = false): Promise<CDPTarget | null> {
    const deadline = Date.now() + (force ? TARGET_WAIT_MS : TARGET_WAIT_MS);
    let attempt = 0;

    while (Date.now() < deadline) {
      if (attempt > 0) {
        process.stdout.write("Waiting for CDP targets...\n");
        await sleep(TARGET_POLL_INTERVAL_MS);
      }
      attempt++;

      const targets = await this.fetchTargets().catch(() => null);
      if (targets === null) return null; // Metro unreachable

      const target =
        targets.find((t) => t.type === "react-native") ??
        targets[0] ??
        null;

      if (target) return target;
    }

    return null;
  }

  private fetchTargets(): Promise<CDPTarget[]> {
    const url = new URL(this.metroUrl);
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: url.hostname, port: url.port || 8081, path: METRO_JSON_PATH },
        (res) => {
          let data = "";
          res.on("data", (c: Buffer) => { data += c.toString(); });
          res.on("end", () => {
            try { resolve(JSON.parse(data) as CDPTarget[]); }
            catch { resolve([]); }
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error("timeout")); });
    });
  }

  // ── 1.3 WebSocket connection ──────────────────────────────────────────────

  async connect(forceNewArch = false): Promise<boolean> {
    const target = await this.discoverTarget(forceNewArch);
    if (!target) return false;

    await this.connectToTarget(target.webSocketDebuggerUrl);
    return true;
  }

  private async connectToTarget(wsUrl: string): Promise<void> {
    // Normalise — Metro sometimes returns a relative path
    const fullUrl = wsUrl.startsWith("ws")
      ? wsUrl
      : `ws://localhost:${new URL(this.metroUrl).port || 8081}${wsUrl}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(fullUrl);
      this.ws = ws;

      ws.on("open", () => {
        this.connected = true;
        this.send("Runtime.enable", {});
        this.send("Network.enable", {});
        resolve();
      });

      ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(JSON.parse(data.toString()) as CDPResponse & CDPEvent);
      });

      ws.on("close", () => {
        this.connected = false;
        if (!this.reconnecting) this.scheduleReconnect();
      });

      ws.on("error", (err) => {
        if (!this.connected) reject(err);
      });
    });
  }

  // ── 1.5 Reconnect ─────────────────────────────────────────────────────────

  private scheduleReconnect() {
    this.reconnecting = true;
    setTimeout(async () => {
      const target = await this.discoverTarget().catch(() => null);
      if (target) {
        await this.connectToTarget(target.webSocketDebuggerUrl).catch(() => {});
      }
      this.reconnecting = false;
    }, RECONNECT_DELAY_MS);
  }

  disconnect() {
    this.reconnecting = true; // suppress auto-reconnect
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  // ── 1.4 CDP request helper ────────────────────────────────────────────────

  private send(method: string, params: unknown) {
    const msg: CDPRequest = { id: uuidv4(), method, params };
    this.ws?.send(JSON.stringify(msg));
    return msg.id;
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.connected || !this.ws) {
      throw new Error("CDP not connected.");
    }

    return new Promise<T>((resolve, reject) => {
      const id = uuidv4();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`CDP request '${method}' timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      const msg: CDPRequest = { id, method, params };
      this.ws!.send(JSON.stringify(msg));
    });
  }

  private handleMessage(msg: (CDPResponse & CDPEvent)) {
    // Response to a pending request
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // 2.5 Error events
    if (msg.method === "Runtime.exceptionThrown" && msg.params) {
      const exc = msg.params as RuntimeException;
      if (this.errorBuffer.length >= ERROR_BUFFER_SIZE) this.errorBuffer.shift();
      this.errorBuffer.push(exc);
    }

    // 2.6 Network events
    if (msg.method === "Network.requestWillBeSent" && msg.params) {
      const p = msg.params as {
        requestId: string;
        request: { method: string; url: string; headers: Record<string, string>; postData?: string };
        timestamp: number;
      };
      this.networkLog.set(p.requestId, {
        requestId: p.requestId,
        method: p.request.method,
        url: p.request.url,
        requestHeaders: p.request.headers,
        requestBody: p.request.postData,
        requestStartTime: p.timestamp,
      });
    }

    if (msg.method === "Network.responseReceived" && msg.params) {
      const p = msg.params as {
        requestId: string;
        response: { status: number; headers: Record<string, string> };
        timestamp: number;
      };
      const existing = this.networkLog.get(p.requestId);
      if (existing) {
        existing.status = p.response.status;
        existing.responseHeaders = p.response.headers;
        if (existing.requestStartTime) {
          existing.duration = Math.round((p.timestamp - existing.requestStartTime) * 1000);
        }
      }
    }
  }

  // ── 2.1 evaluate ──────────────────────────────────────────────────────────

  async evaluate(script: string): Promise<string> {
    const result = await this.request<{
      result: { value?: unknown; description?: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      );
    }

    return JSON.stringify(result.result.value ?? result.result.description, null, 2);
  }

  // ── 2.2 getTree ───────────────────────────────────────────────────────────

  async getTree(): Promise<string> {
    let nodes: ComponentNode[];
    try {
      const result = await this.request<{ nodes: ComponentNode[] }>(
        "ReactDevTools.getComponentTree",
        { rendererID: 1 }
      );
      nodes = result.nodes;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("-32601") || msg.includes("not found") || msg.includes("not supported")) {
        throw new Error(
          "Component tree not available. Open React Native DevTools (press j in Metro) to enable inspection."
        );
      }
      throw err;
    }

    const nodeMap = new Map<number, ComponentNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const allChildIds = new Set(nodes.flatMap((n) => n.children));
    const roots = nodes.filter((n) => !allChildIds.has(n.id));

    const lines: string[] = [];
    const walk = (id: number, depth: number) => {
      const node = nodeMap.get(id);
      if (!node) return;
      lines.push(`${"  ".repeat(depth)}[${id}] ${node.displayName ?? "(anonymous)"}`);
      for (const childId of node.children) walk(childId, depth + 1);
    };
    for (const root of roots) walk(root.id, 0);

    return lines.join("\n") || "(empty tree)";
  }

  // ── 2.3 inspect ───────────────────────────────────────────────────────────

  async inspect(id: string): Promise<string | null> {
    let el: ComponentNode | null = null;
    try {
      const result = await this.request<{ value: ComponentNode } | null>(
        "ReactDevTools.inspectElement",
        { id: Number(id), rendererID: 1, path: null }
      );
      el = result?.value ?? null;
    } catch {
      return null;
    }

    if (!el) return null;

    const lines: string[] = [];
    lines.push(`Component:  ${el.displayName ?? "(anonymous)"}`);
    if (el.source) lines.push(`Source:     ${el.source.fileName}:${el.source.lineNumber}`);
    if (el.props && Object.keys(el.props).length > 0) {
      lines.push("Props:");
      for (const [k, v] of Object.entries(el.props)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
    if (el.state !== null && el.state !== undefined) {
      lines.push(`State:      ${JSON.stringify(el.state, null, 2)}`);
    }
    if (el.hooks && el.hooks.length > 0) {
      lines.push("Hooks:");
      for (const h of el.hooks) lines.push(`  ${h.name}: ${JSON.stringify(h.value)}`);
    }

    return lines.join("\n");
  }

  // ── 2.4 find ──────────────────────────────────────────────────────────────

  async find(name: string): Promise<string> {
    const result = await this.request<{ nodes: ComponentNode[] }>(
      "ReactDevTools.getComponentTree",
      { rendererID: 1 }
    );
    const lower = name.toLowerCase();
    const matches = result.nodes.filter((n) =>
      (n.displayName ?? "").toLowerCase().includes(lower)
    );
    if (matches.length === 0) return `No components matching "${name}" found.`;
    return matches.map((n) => `[${n.id}] ${n.displayName ?? "(anonymous)"}`).join("\n");
  }

  // ── 2.5 getErrors ─────────────────────────────────────────────────────────

  getErrors(): string {
    if (this.errorBuffer.length === 0) return "";
    return this.errorBuffer
      .map((e) => {
        const msg = e.exceptionDetails.exception?.description ?? e.exceptionDetails.text;
        const frames = e.exceptionDetails.stackTrace?.callFrames ?? [];
        const stack = frames
          .slice(0, 5)
          .map((f) => `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber})`)
          .join("\n");
        return stack ? `${msg}\n${stack}` : msg;
      })
      .join("\n\n");
  }

  // ── 2.6 getNetwork ────────────────────────────────────────────────────────

  getNetwork(idx?: number): string {
    const entries = Array.from(this.networkLog.values());
    if (entries.length === 0) return "No network requests captured.";

    if (idx !== undefined) {
      const req = entries[idx];
      if (!req) return `No request at index ${idx}.`;
      const lines = [
        `[${idx}] ${req.method} ${req.url}`,
        `Status:   ${req.status ?? "pending"}`,
        `Duration: ${req.duration !== undefined ? `${req.duration}ms` : "—"}`,
      ];
      if (req.requestHeaders) {
        lines.push("Request Headers:");
        for (const [k, v] of Object.entries(req.requestHeaders)) lines.push(`  ${k}: ${v}`);
      }
      if (req.requestBody) lines.push(`Request Body:\n${req.requestBody}`);
      if (req.responseHeaders) {
        lines.push("Response Headers:");
        for (const [k, v] of Object.entries(req.responseHeaders)) lines.push(`  ${k}: ${v}`);
      }
      return lines.join("\n");
    }

    return entries
      .map((r, i) =>
        `[${i}] ${r.method} ${r.url} — ${r.status ?? "pending"} (${r.duration !== undefined ? `${r.duration}ms` : "—"})`
      )
      .join("\n");
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

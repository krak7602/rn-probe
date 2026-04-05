import WebSocket from "ws";
import { state } from "./state.js";

const DEVTOOLS_PORT = 8097;
const RECONNECT_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 10_000;

// ── RN DevTools protocol helpers ──────────────────────────────────────────────
// The RN DevTools backend speaks the React DevTools protocol over a WebSocket.
// Messages are JSON with a `type` field. The bridge must send `wall-connect`
// to attach as a DevTools frontend, then exchange typed messages.

interface DevToolsMessage {
  type: string;
  payload?: unknown;
}

interface ComponentNode {
  id: number;
  displayName: string | null;
  children: number[];
  props?: Record<string, unknown>;
  state?: unknown;
  hooks?: unknown[];
  source?: { fileName: string; lineNumber: number } | null;
}

interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
}

// ── DevToolsBridge ────────────────────────────────────────────────────────────

export class DevToolsBridge {
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private componentTree: Map<number, ComponentNode> = new Map();
  private networkLog: NetworkRequest[] = [];
  private perfEvents: Array<{ ts: number; jsFps: number; uiFps: number }> = [];

  async connect(): Promise<void> {
    return new Promise((resolve) => {
      this.tryConnect(resolve);
    });
  }

  private tryConnect(onFirstConnect?: () => void) {
    const ws = new WebSocket(`ws://localhost:${DEVTOOLS_PORT}`);
    this.ws = ws;

    ws.on("open", () => {
      // Introduce ourselves as a DevTools frontend
      ws.send(JSON.stringify({ type: "react-devtools-inject-backend" }));
      this.connected = true;
      state.devtoolsConnected = true;
      onFirstConnect?.();
    });

    ws.on("message", (data: WebSocket.RawData) => {
      this.handleMessage(JSON.parse(data.toString()) as DevToolsMessage);
    });

    ws.on("close", () => {
      this.connected = false;
      state.devtoolsConnected = false;
      // Reconnect after delay
      setTimeout(() => this.tryConnect(), RECONNECT_DELAY_MS);
    });

    ws.on("error", () => {
      // Will trigger close which handles reconnect
      onFirstConnect?.(); // resolve connect() even if DevTools unavailable
    });
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    state.devtoolsConnected = false;
  }

  // ── Message dispatch ─────────────────────────────────────────────────────────

  private handleMessage(msg: DevToolsMessage) {
    // Resolve pending request if response matches
    if (msg.type === "inspectElement" || msg.type === "getComponentTree") {
      const pending = this.pendingRequests.get(msg.type);
      if (pending) {
        this.pendingRequests.delete(msg.type);
        pending.resolve(msg.payload);
      }
    }

    // Update component tree cache
    if (msg.type === "operations" && msg.payload) {
      this.applyTreeOperations(msg.payload as unknown[]);
    }

    // Capture network events
    if (msg.type === "network-request-received" && msg.payload) {
      const req = msg.payload as NetworkRequest;
      const existing = this.networkLog.findIndex((r) => r.id === req.id);
      if (existing >= 0) {
        this.networkLog[existing] = { ...this.networkLog[existing], ...req };
      } else {
        this.networkLog.push(req);
      }
    }

    // Capture perf events
    if (msg.type === "performance" && msg.payload) {
      const p = msg.payload as { jsFps: number; uiFps: number };
      this.perfEvents.push({ ts: Date.now(), jsFps: p.jsFps, uiFps: p.uiFps });
      if (this.perfEvents.length > 100) this.perfEvents.shift();
    }
  }

  private applyTreeOperations(ops: unknown[]) {
    // The React DevTools "operations" message encodes tree mutations as a flat
    // integer array. For simplicity we rebuild from full snapshots sent by
    // getComponentTree and only use this to detect staleness.
    // A full operations parser is a future improvement.
    void ops;
  }

  // ── Request helper ───────────────────────────────────────────────────────────

  private request<T>(type: string, payload?: unknown): Promise<T> {
    if (!this.connected || !this.ws) {
      throw new Error("RN DevTools not connected. Is your app running with dev mode enabled?");
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(type);
        reject(new Error(`DevTools request '${type}' timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(type, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      this.ws!.send(JSON.stringify({ type, payload }));
    });
  }

  // ── Tree ─────────────────────────────────────────────────────────────────────

  async getTree(): Promise<string> {
    // Request a fresh snapshot
    const snapshot = await this.request<{ nodes: ComponentNode[] }>("getComponentTree", { rendererID: 1 });
    const nodes = new Map<number, ComponentNode>();
    for (const n of snapshot.nodes) nodes.set(n.id, n);

    const roots = snapshot.nodes.filter((n) => {
      // Root nodes are not referenced as a child by any other node
      const allChildIds = new Set(snapshot.nodes.flatMap((x) => x.children));
      return !allChildIds.has(n.id);
    });

    const lines: string[] = [];
    const walk = (id: number, depth: number) => {
      const node = nodes.get(id);
      if (!node) return;
      lines.push(`${"  ".repeat(depth)}[${id}] ${node.displayName ?? "(anonymous)"}`);
      for (const childId of node.children) walk(childId, depth + 1);
    };

    for (const root of roots) walk(root.id, 0);
    return lines.join("\n") || "(empty tree)";
  }

  // ── Inspect ──────────────────────────────────────────────────────────────────

  async inspect(id: string): Promise<string> {
    const result = await this.request<{ id: number; value: ComponentNode } | null>(
      "inspectElement",
      { id: Number(id), rendererID: 1, path: null }
    );

    if (!result) return `Component ${id} not found.`;

    const el = result.value;
    const lines: string[] = [];
    lines.push(`Component:  ${el.displayName ?? "(anonymous)"}`);
    if (el.source) lines.push(`Source:     ${el.source.fileName}:${el.source.lineNumber}`);

    if (el.props && Object.keys(el.props).length > 0) {
      lines.push("Props:");
      for (const [k, v] of Object.entries(el.props)) {
        lines.push(`  ${k}: ${JSON.stringify(v)}`);
      }
    }

    if (el.state !== null && el.state !== undefined) {
      lines.push(`State:      ${JSON.stringify(el.state, null, 2)}`);
    }

    if (el.hooks && (el.hooks as unknown[]).length > 0) {
      lines.push("Hooks:");
      for (const h of el.hooks as Array<{ name: string; value: unknown }>) {
        lines.push(`  ${h.name}: ${JSON.stringify(h.value)}`);
      }
    }

    return lines.join("\n");
  }

  // ── Find ─────────────────────────────────────────────────────────────────────

  async find(name: string): Promise<string> {
    const snapshot = await this.request<{ nodes: ComponentNode[] }>("getComponentTree", { rendererID: 1 });
    const lower = name.toLowerCase();
    const matches = snapshot.nodes.filter((n) =>
      (n.displayName ?? "").toLowerCase().includes(lower)
    );

    if (matches.length === 0) return `No components matching "${name}" found.`;

    return matches
      .map((n) => `[${n.id}] ${n.displayName ?? "(anonymous)"}`)
      .join("\n");
  }

  // ── Eval ─────────────────────────────────────────────────────────────────────

  async evaluate(script: string): Promise<string> {
    // Use CDP evaluateOnCallFrame via DevTools bridge
    const result = await this.request<{ result: unknown; exceptionDetails?: { text: string; exception?: { description: string } } }>(
      "evaluateOnCallFrame",
      { expression: script, callFrameId: "0" }
    );

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }

    return JSON.stringify(result.result, null, 2);
  }

  // ── Network ──────────────────────────────────────────────────────────────────

  network(idx?: number): string {
    if (this.networkLog.length === 0) {
      return "No network requests captured.\nNote: Network inspection requires Hermes with network inspection enabled.";
    }

    if (idx !== undefined) {
      const req = this.networkLog[idx];
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
      if (req.responseBody) lines.push(`Response Body:\n${req.responseBody}`);
      return lines.join("\n");
    }

    return this.networkLog
      .map((r, i) => `[${i}] ${r.method} ${r.url} — ${r.status ?? "pending"} (${r.duration !== undefined ? `${r.duration}ms` : "—"})`)
      .join("\n");
  }

  // ── Perf ─────────────────────────────────────────────────────────────────────

  getPerfMetrics(): string {
    if (this.perfEvents.length === 0) return "No performance events captured yet.";
    const recent = this.perfEvents.slice(-10);
    const avgJs = Math.round(recent.reduce((s, e) => s + e.jsFps, 0) / recent.length);
    const avgUi = Math.round(recent.reduce((s, e) => s + e.uiFps, 0) / recent.length);
    const slow = this.perfEvents.filter((e) => e.jsFps < 30 || e.uiFps < 30).length;

    return [
      `JS Thread FPS (avg):  ${avgJs}`,
      `UI Thread FPS (avg):  ${avgUi}`,
      `Slow frames (<30fps): ${slow}`,
    ].join("\n");
  }
}

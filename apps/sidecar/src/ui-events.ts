// The UI event hub and the server-sent-events stream that carries host, focus, change, undo and thumbnail events to the panel.
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { errorEnvelope, writeJson } from "./server-http-wire.js";
import type { RequestContext } from "./server-types.js";
import type { UiEvent } from "./ui-contract.js";
import { activityFor, activityViewOf } from "./server-activity.js";
import { focusViewOf, hostViewOf } from "./ui-view.js";

const UI_EVENTS_LIFETIME_MS = 10 * 60_000;
export const MAX_UI_STREAMS = 8;
const CHANGE_INTERVAL_MS = 100, ACTIVITY_MS = 1_000, FALLBACK_MS = 5_000, KEEPALIVE_MS = 15_000, MAX_BACKLOG_BYTES = 262_144;

interface UiPoke { type: "poke" }

class UiEventHub {
  streams = 0;
  private readonly listeners = new Set<(event: UiEvent | UiPoke) => void>();

  publish(event: UiEvent | UiPoke): void {
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { continue; }
    }
  }

  subscribe(listener: (event: UiEvent | UiPoke) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  subscriberCount(): number { return this.listeners.size; }
}

const hubs = new WeakMap<WeakKey, UiEventHub>();

/** Exactly one hub per sidecar; Cards F1 and F2 publish undo and thumbnail events through it. */
export function uiEventsFor(state: WeakKey): UiEventHub {
  let hub = hubs.get(state);
  if (!hub) {
    hub = new UiEventHub();
    hubs.set(state, hub);
  }
  return hub;
}

function frameOf(event: UiEvent): string {
  const { type, ...payload } = event;
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

interface UiStreamOptions { lifetimeMs?: number; context?: RequestContext }

class UiEventStream {
  private readonly deps: HttpRoutesDeps;
  private readonly response: ServerResponse;
  private readonly hub: UiEventHub;
  private readonly timers = new Set<NodeJS.Timeout>();
  private unsubscribe: (() => void) | undefined;
  private changeTimer: NodeJS.Timeout | undefined;
  private readonly lastFrames: Record<string, string> = { host: "", focus: "", activity: "" };
  private lastMcpRev = 0;
  private lastChangeAt = 0;
  private seq = 0;
  private closed = false;

  constructor(deps: HttpRoutesDeps, response: ServerResponse, hub: UiEventHub) {
    this.deps = deps;
    this.response = response;
    this.hub = hub;
  }

  open(lifetimeMs: number): void {
    this.hub.streams += 1;
    this.response.once("close", this.cleanup);
    this.response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    this.response.socket?.setNoDelay(true);
    this.write("retry: 1000\n\n");
    this.evaluate();
    this.emitChange();
    this.deps.state.changeWaiters.add(this.wake);
    this.unsubscribe = this.hub.subscribe(this.onHub);
    this.every(FALLBACK_MS, () => { this.checkServer(); this.evaluate(); });
    this.every(ACTIVITY_MS, () => this.sendActivity());
    this.every(KEEPALIVE_MS, () => this.write(": keepalive\n\n"));
    const lifetime = setTimeout(this.end, lifetimeMs);
    lifetime.unref();
    this.timers.add(lifetime);
  }

  private readonly wake = (): void => {
    if (this.closed) return;
    this.deps.state.changeWaiters.add(this.wake);
    this.guarded(() => { this.evaluate(); this.scheduleChange(); });
  };

  private readonly onHub = (event: UiEvent | UiPoke): void => {
    this.guarded(() => { if (event.type !== "poke") this.forward(event); this.evaluate(); });
  };

  private readonly end = (): void => {
    if (this.closed) return;
    this.cleanup();
    const socket = this.response.socket;
    this.response.end(() => socket?.destroy());
  };

  private readonly cleanup = (): void => {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) { clearInterval(timer); clearTimeout(timer); }
    this.timers.clear();
    clearTimeout(this.changeTimer);
    this.deps.state.changeWaiters.delete(this.wake);
    this.unsubscribe?.();
    this.hub.streams -= 1;
  };

  private every(ms: number, action: () => void): void {
    const timer = setInterval(() => this.guarded(action), ms);
    timer.unref();
    this.timers.add(timer);
  }

  private guarded(action: () => void): void {
    try { action(); } catch { this.end(); }
  }

  private checkServer(): void {
    if (!this.deps.state.server) this.end();
  }

  private write(chunk: string): void {
    if (this.closed) return;
    this.response.write(chunk);
    if (this.response.writableLength > MAX_BACKLOG_BYTES) this.end();
  }

  private evaluate(): void {
    const host = hostViewOf(this.deps.state);
    this.forward({ type: "host", ...host });
    this.forward({ type: "focus", focus: focusViewOf(this.deps) });
    this.sendActivity();
  }

  private sendActivity(): void {
    this.forward({ type: "activity", ...activityViewOf(this.deps.state) });
    const log = activityFor(this.deps.state), calls = log.callsAfter(this.lastMcpRev);
    if (!calls.length) return;
    this.lastMcpRev = log.latestRev;
    this.write(frameOf({ type: "mcp", calls }));
  }

  private forward(event: UiEvent): void {
    const frame = frameOf(event);
    if (event.type in this.lastFrames) {
      if (frame === this.lastFrames[event.type]) return;
      this.lastFrames[event.type] = frame;
    }
    this.write(frame);
  }

  private scheduleChange(): void {
    if (this.changeTimer) return;
    const wait = Math.max(0, CHANGE_INTERVAL_MS - (performance.now() - this.lastChangeAt));
    this.changeTimer = setTimeout(() => { this.changeTimer = undefined; this.guarded(() => this.emitChange()); }, wait);
    this.changeTimer.unref();
  }

  private emitChange(): void {
    if (!this.deps.state.server && this.seq > 0) { this.end(); return; }
    this.seq += 1;
    this.lastChangeAt = performance.now();
    this.forward({ type: "change", seq: this.seq, reason: "state" });
  }
}

function refuseBusy(deps: HttpRoutesDeps, response: ServerResponse, context: RequestContext | undefined): void {
  const body = errorEnvelope("UI_EVENTS_BUSY", `At most ${MAX_UI_STREAMS} event streams may be open at once.`);
  if (context) deps.dispatch.respond({ response, context, statusCode: 429, value: body, outcome: "rejected", errorCode: "UI_EVENTS_BUSY" });
  else writeJson(response, 429, body);
}

/** Streams events until the client leaves, the sidecar stops, or the lifetime ends so the client reconnects from fresh state. */
export function streamUiEvents(deps: HttpRoutesDeps, request: IncomingMessage, response: ServerResponse, options: UiStreamOptions = {}): void {
  const hub = uiEventsFor(deps.state);
  if (hub.streams >= MAX_UI_STREAMS) { refuseBusy(deps, response, options.context); request.resume(); return; }
  const stream = new UiEventStream(deps, response, hub);
  stream.open(options.lifetimeMs ?? UI_EVENTS_LIFETIME_MS);
  if (options.context) deps.dispatch.emit(options.context, "response", "request.completed", { outcome: "succeeded", statusCode: 200 });
}

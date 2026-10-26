// The plugin client: three loopback connections, FIFO requests matched to responses by id, a stall monitor that pings the control connection,
// and one onClose for the whole link, fired by whichever of host-closing, a reset or a client close comes first.
import net from "node:net";
import type { Socket } from "node:net";
import { decode } from "@extynt/decode";
import type { Decoder, JsonObject, JsonValue } from "@extynt/decode";
import type { CallOptions, CallOutcome, ConnectOptions, JsonPluginClient, PluginEndpoint, StallReport } from "./client-types.js";
import { WatchConnection } from "./events.js";
import type { WatchHooks, WatchRequestLine } from "./events.js";
import { Lifecycle } from "./link-lifecycle.js";
import { IDLE_STALL_MS, isMutationEntry } from "./protocol.js";
import type { BatchEntry, BatchRequest, HostEntry, PluginOp } from "./protocol.js";
import { RequestChannel, lost } from "./request-channel.js";
import type { Raw, RequestBody } from "./request-channel.js";
import { batchResult, hostCallResult } from "./wire-calls.js";
import type { BatchResult, HostCallResult } from "./wire-calls.js";
import { pingDirectResult } from "./wire-ping.js";
import type { PingDirectResult } from "./wire-ping.js";

const READ_TIMEOUT_MS = 60_000;
const MUTATION_TIMEOUT_MS = 900_000;
const STALL_AFTER_MS = 2000;
const STALL_PING_INTERVAL_MS = 1000;
const PING_TIMEOUT_MS = 1000;

export class PluginConnectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PluginConnectError";
    this.code = code;
  }
}

function toOutcome(raw: Raw): CallOutcome<JsonValue> {
  if (raw.kind === "lost") return raw;
  const { response, rttMs } = raw;
  if (response.ok) return { kind: "ok", result: response.result, timing: response.timing, rttMs };
  return response.error.code === "SHUTTING_DOWN" ? lost("shutting-down", false, rttMs) : { kind: "refused", error: response.error, rttMs };
}

function decodedOutcome<R>(outcome: CallOutcome<JsonValue>, decoder: Decoder<R>): CallOutcome<R> {
  if (outcome.kind !== "ok") return outcome;
  const decoded = decode(decoder, outcome.result);
  return decoded.ok ? { ...outcome, result: decoded.value } : lost("protocol", true, outcome.rttMs);
}

function assertCallerType<R>(result: JsonValue): asserts result is R & JsonValue {}

function isMutationBody(body: RequestBody): boolean {
  if (body.op === "host_call") return isMutationEntry(body.entry);
  return body.op === "batch" && body.ops.some((entry) => entry.op === "host_call" && isMutationEntry(entry.entry));
}

/** Judges a stalled call from the control connection's answer to a ping: a lost ping means the plugin is unresponsive, an old idle age or an open dialog means After Effects is busy. */
export function stallReport(outcome: CallOutcome<PingDirectResult>, waitedMs: number): StallReport {
  if (outcome.kind === "lost") return { waitedMs, idleAgeMs: null, queueDepth: null, dialog: null, verdict: "plugin-unresponsive" };
  if (outcome.kind === "refused") return { waitedMs, idleAgeMs: null, queueDepth: null, dialog: null, verdict: "slow" };
  const { idleAgeMs, queueDepth } = outcome.result;
  const dialog = outcome.result.waitingOnDialog ?? null;
  const busy = dialog !== null || (idleAgeMs !== null && idleAgeMs > IDLE_STALL_MS);
  return { waitedMs, idleAgeMs, queueDepth, dialog, verdict: busy ? "ae-busy" : "slow" };
}

class Client implements JsonPluginClient {
  readonly endpoint: PluginEndpoint;
  private readonly commands: RequestChannel;
  private readonly control: RequestChannel;
  private readonly lifecycle: Lifecycle;

  constructor(endpoint: PluginEndpoint, commands: RequestChannel, control: RequestChannel, lifecycle: Lifecycle) {
    this.endpoint = endpoint;
    this.commands = commands;
    this.control = control;
    this.lifecycle = lifecycle;
  }

  async request<R = JsonValue>(op: PluginOp, options: CallOptions = {}): Promise<CallOutcome<R>> {
    const outcome = await this.requestJson(op, options);
    if (outcome.kind !== "ok") return outcome;
    const { result } = outcome;
    assertCallerType<R>(result);
    return { ...outcome, result };
  }

  requestJson(op: PluginOp, options: CallOptions = {}): Promise<CallOutcome<JsonValue>> {
    return this.invoke(op, options);
  }

  async batch(ops: readonly BatchEntry[], options: CallOptions & { stopOnError?: boolean } = {}): Promise<CallOutcome<BatchResult>> {
    const body: BatchRequest = { op: "batch", ops: [...ops], ...(options.stopOnError === undefined ? {} : { stopOnError: options.stopOnError }) };
    return decodedOutcome(await this.invoke(body, options), batchResult);
  }

  hostCall(entry: HostEntry, args: JsonObject, options: CallOptions = {}): Promise<CallOutcome<HostCallResult>> {
    return this.hostCallWithArguments(entry, JSON.stringify(args), options);
  }

  hostCallJson(entry: HostEntry, args: JsonObject, options: CallOptions = {}): Promise<CallOutcome<HostCallResult>> {
    return this.hostCallWithArguments(entry, JSON.stringify(args), options);
  }

  async pingDirect(timeoutMs: number = PING_TIMEOUT_MS): Promise<CallOutcome<PingDirectResult>> {
    return decodedOutcome(toOutcome(await this.control.submit({ op: "ping_direct" }, timeoutMs, null)), pingDirectResult);
  }

  close(): void {
    this.lifecycle.finish("closed-by-client");
  }

  private async hostCallWithArguments(entry: HostEntry, args: string, options: CallOptions): Promise<CallOutcome<HostCallResult>> {
    return decodedOutcome(await this.invoke({ op: "host_call", entry, args }, options), hostCallResult);
  }

  private async invoke(body: RequestBody, options: CallOptions): Promise<CallOutcome<JsonValue>> {
    const timeoutMs = options.timeoutMs ?? (isMutationBody(body) ? MUTATION_TIMEOUT_MS : READ_TIMEOUT_MS);
    const enqueuedAt = performance.now();
    let stop = (): void => undefined;
    const onSent = options.onStall ? () => { stop = this.monitorStall(options, enqueuedAt); } : null;
    try {
      return toOutcome(await this.commands.submit(body, timeoutMs, onSent));
    } finally {
      stop();
    }
  }

  private monitorStall(options: CallOptions, enqueuedAt: number): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    const tick = async (): Promise<void> => {
      const outcome = await this.pingDirect(PING_TIMEOUT_MS);
      if (stopped) return;
      options.onStall?.(stallReport(outcome, performance.now() - enqueuedAt));
      timer = setTimeout(() => void tick(), STALL_PING_INTERVAL_MS);
    };
    timer = setTimeout(() => void tick(), options.stallAfterMs ?? STALL_AFTER_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}

function defaultConnection(port: number): Socket {
  return net.createConnection({ port, host: "127.0.0.1" });
}

function openSocket(create: (port: number) => Socket, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = create(port);
    if (socket.readyState === "open") {
      resolve(socket);
      return;
    }
    const fail = (error: Error): void => reject(error);
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.off("error", fail);
      resolve(socket);
    });
  });
}

function connectFailure(detail: string, port: number): PluginConnectError {
  return new PluginConnectError("CONNECT_FAILED", `Cannot connect to the plugin at 127.0.0.1:${port}: ${detail}. The discovery file may be stale.`);
}

function startWatch(socket: Socket, request: WatchRequestLine, hooks: WatchHooks, lifecycle: Lifecycle): WatchConnection {
  const watch = new WatchConnection(socket, request, hooks);
  lifecycle.register(() => watch.destroy());
  return watch;
}

/** Opens command, control and watch connections; resolves once the watch subscription is confirmed, so the token is proven. */
export async function connectPlugin(options: ConnectOptions): Promise<JsonPluginClient> {
  const { endpoint } = options;
  const create = options.createConnection ?? defaultConnection;
  const lifecycle = new Lifecycle(options.onClose);
  let counter = 0;
  const nextId = (): string => String(++counter);
  const channel = (socket: Socket): RequestChannel => new RequestChannel(socket, endpoint.token, nextId, lifecycle);
  const hooks: WatchHooks = {
    onEvent: options.onEvent,
    onEnd: (cause) => { if (cause === "host-closing") lifecycle.hostClosing(); else lifecycle.finish("reset"); },
  };
  const request = { id: nextId(), token: endpoint.token, ...options.watch };
  try {
    const [commands, control, watch] = await Promise.all([
      openSocket(create, endpoint.port).then(channel),
      openSocket(create, endpoint.port).then(channel),
      openSocket(create, endpoint.port).then((socket) => startWatch(socket, request, hooks, lifecycle)),
    ]);
    const started = await watch.started;
    if (!started.ok) throw new PluginConnectError(started.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "WATCH_FAILED", started.message);
    return new Client(endpoint, commands, control, lifecycle);
  } catch (error) {
    lifecycle.closeWithoutReport();
    if (error instanceof PluginConnectError) throw error;
    throw connectFailure(error instanceof Error ? error.message : String(error), endpoint.port);
  }
}

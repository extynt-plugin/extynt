/** A client for the native plugin's request protocol. */
import net from "node:net";
import { decodeJson, isNotJson } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { SpikeError, systemCode } from "./errors.ts";
import { hrMs } from "./stats.ts";
import { NATIVE_RESPONSE } from "./wire.ts";
import type { NativeResponse } from "./wire.ts";

const NEWLINE = 0x0a;
const LOOPBACK = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 30000;

/** Where the plugin listens. */
export interface Endpoint {
  readonly host: string;
  readonly port: number;
}

/** What a client needs to reach the plugin; the host and timeout have defaults. */
export interface ClientOptions {
  readonly host?: string;
  readonly port: number;
  readonly token: string;
  readonly timeoutMs?: number;
}

/** A decoded response with how long it took and how large it was. */
export interface Answer {
  readonly response: NativeResponse;
  readonly rttMs: number;
  readonly responseBytes: number;
}

interface Pending {
  readonly resolve: (answer: Answer) => void;
  readonly reject: (error: SpikeError) => void;
  readonly timer: NodeJS.Timeout;
  readonly startedAt: bigint;
}

function connectionMessage(error: Error, target: Endpoint): string {
  const where = `${target.host}:${target.port}`;
  if (systemCode(error) === "ECONNREFUSED") {
    return `Connection refused at ${where}. The discovery file is probably stale (After Effects restarted or the plugin's listener is down); restart After Effects and retry.`;
  }
  return `Cannot connect to ${where}: ${error.message}`;
}

/**
 * Newline-delimited JSON client: one request in flight per connection.
 * rttMs spans the socket write to the arrival of the full response line, before JSON parsing.
 */
export class NativeClient {
  readonly target: Endpoint;
  readonly token: string;
  readonly timeoutMs: number;
  private nextId = 1;
  private pending: Pending | null = null;
  private parts: Buffer[] = [];
  private socket: net.Socket | null = null;

  constructor(options: ClientOptions) {
    this.target = { host: options.host ?? LOOPBACK, port: options.port };
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  connect(): Promise<this> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.target);
      const failConnect = (error: Error) => reject(new SpikeError("CONNECT_FAILED", connectionMessage(error, this.target)));
      socket.once("error", failConnect);
      socket.once("connect", () => {
        socket.off("error", failConnect);
        socket.setNoDelay(true);
        this.attach(socket);
        resolve(this);
      });
    });
  }

  private attach(socket: net.Socket): void {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (error) => this.settle(new SpikeError("CONNECTION_ERROR", `Connection error: ${error.message}`)));
    socket.on("close", () => this.settle(new SpikeError("CONNECTION_CLOSED", "The plugin closed the connection before answering (After Effects quit, or the request was rejected).")));
  }

  private onData(chunk: Buffer): void {
    let rest = chunk;
    for (let end = rest.indexOf(NEWLINE); end !== -1; end = rest.indexOf(NEWLINE)) {
      const arrivedAt = process.hrtime.bigint();
      const line = Buffer.concat([...this.parts, rest.subarray(0, end)]);
      this.parts = [];
      rest = rest.subarray(end + 1);
      this.deliver(line, arrivedAt);
    }
    if (rest.length) this.parts.push(rest);
  }

  private deliver(line: Buffer, arrivedAt: bigint): void {
    if (!this.pending) return;
    const { startedAt } = this.pending;
    const text = line.toString("utf8");
    const decoded = decodeJson(text, NATIVE_RESPONSE);
    if (!decoded.ok) {
      const reason = isNotJson(decoded.error) ? `Response was not valid JSON: ${text.slice(0, 120)}` : `Response was not a valid reply: ${decoded.error.message}`;
      this.settle(new SpikeError("PROTOCOL", reason));
      return;
    }
    this.settle(null, { response: decoded.value, rttMs: hrMs(startedAt, arrivedAt), responseBytes: line.length });
  }

  private settle(error: SpikeError | null, answer?: Answer): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else if (answer) pending.resolve(answer);
  }

  request(op: string, params: JsonObject = {}): Promise<Answer> {
    const socket = this.socket;
    if (!socket || this.pending) return Promise.reject(new SpikeError("CLIENT_STATE", "Not connected, or a request is already in flight."));
    const id = String(this.nextId++);
    const line = `${JSON.stringify({ id, token: this.token, op, ...params })}\n`;
    return new Promise<Answer>((resolve, reject) => {
      const timer = setTimeout(() => this.timeout(op), this.timeoutMs);
      this.pending = { resolve, reject, timer, startedAt: process.hrtime.bigint() };
      socket.write(line);
    }).then((answer) => checkId(answer, id));
  }

  private timeout(op: string): void {
    this.settle(new SpikeError("TIMEOUT", `No response to "${op}" within ${this.timeoutMs} ms. After Effects may be busy (modal dialog, render) or the idle hook is not running; raise --timeout-ms to wait longer.`));
    this.close();
  }

  async call(op: string, params: JsonObject = {}): Promise<Answer> {
    const answer = await this.request(op, params);
    assertOk(answer.response, op);
    return answer;
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}

function checkId(answer: Answer, id: string): Answer {
  const answered = answer.response.id;
  if (answered === "" && !answer.response.ok) return answer;
  if (answered !== undefined && answered !== id) {
    throw new SpikeError("PROTOCOL", `Response id ${answered} does not match request id ${id}.`);
  }
  return answer;
}

/** Throws a SpikeError naming the op and the plugin's error unless the response is ok; a rejected token is explained as a stale discovery file. */
export function assertOk(response: NativeResponse, op: string): void {
  if (response.ok) return;
  const { code = "UNKNOWN", message = "no message" } = response.error ?? {};
  if (code === "UNAUTHORIZED") {
    throw new SpikeError("UNAUTHORIZED", `The plugin rejected the token (${message}). The discovery file is stale or belongs to another After Effects instance; restart After Effects or pass the right --discovery file.`);
  }
  throw new SpikeError(code, `Operation "${op}" failed: ${message}`, 1);
}

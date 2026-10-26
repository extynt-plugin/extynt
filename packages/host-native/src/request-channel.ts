// One command or control connection: a FIFO of requests with one in flight, each matched to its response by id and failed by timeout, close or protocol error.
import type { Socket } from "node:net";
import { LineConnection } from "./events.js";
import type { EndCause } from "./events.js";
import type { Lifecycle, LostReason } from "./link-lifecycle.js";
import { MAX_REQUEST_BYTES } from "./protocol.js";
import type { BatchRequest, PingDirectRequest, PluginOp } from "./protocol.js";
import { parseResponseLine } from "./wire-response.js";
import type { ResponseEnvelope } from "./wire-response.js";

type Lost = { kind: "lost"; reason: LostReason; sent: boolean; waitedMs: number };
export type RequestBody = PluginOp | BatchRequest | PingDirectRequest;
export type Raw = { kind: "answered"; response: ResponseEnvelope; rttMs: number } | Lost;

interface Job { id: string; line: string; enqueuedAt: number; sentAt: number; timer: NodeJS.Timeout | null; onSent: (() => void) | null; settle(raw: Raw): void }

export function lost(reason: LostReason, sent: boolean, waitedMs: number): Lost {
  return { kind: "lost", reason, sent, waitedMs };
}

function tooLarge(id: string): Raw {
  const message = `Request line exceeds ${MAX_REQUEST_BYTES} bytes; it was not sent.`;
  return { kind: "answered", rttMs: 0, response: { ok: false, id, op: "", error: { code: "REQUEST_TOO_LARGE", message } } };
}

export class RequestChannel {
  private readonly line: LineConnection;
  private readonly token: string;
  private readonly nextId: () => string;
  private readonly queue: Job[] = [];
  private readonly abandoned = new Set<string>();
  private readonly lifecycle: Lifecycle;
  private current: Job | null = null;
  private socketEnded = false;
  private closed = false;

  constructor(socket: Socket, token: string, nextId: () => string, lifecycle: Lifecycle) {
    this.token = token;
    this.nextId = nextId;
    this.lifecycle = lifecycle;
    this.line = new LineConnection(socket, {
      onLine: (text, arrivedAt) => this.onLine(text, arrivedAt),
      onEnd: (cause) => this.onEnd(cause),
    });
    lifecycle.register((reason) => this.close(reason));
  }

  submit(body: RequestBody, timeoutMs: number, onSent: (() => void) | null): Promise<Raw> {
    const now = performance.now();
    if (this.closed || this.socketEnded) return Promise.resolve(lost("closed", false, 0));
    const id = this.nextId();
    const line = `${JSON.stringify({ ...body, id, token: this.token })}\n`;
    if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) return Promise.resolve(tooLarge(id));
    return new Promise((resolve) => {
      const job: Job = { id, line, enqueuedAt: now, sentAt: 0, timer: null, onSent, settle: resolve };
      job.timer = setTimeout(() => this.timeOut(job), timeoutMs);
      this.queue.push(job);
      this.pump();
    });
  }

  close(reason: LostReason): void {
    if (this.closed) return;
    this.closed = true;
    this.line.destroy();
    this.failAll(reason);
  }

  private pump(): void {
    const job = this.queue[0];
    if (this.current || !job) return;
    this.queue.shift();
    this.current = job;
    job.sentAt = performance.now();
    if (!this.line.send(job.line)) {
      this.finishCurrent(lost("closed", true, job.sentAt - job.enqueuedAt));
      return;
    }
    job.onSent?.();
  }

  private finishCurrent(raw: Raw): void {
    const job = this.current;
    if (!job) return;
    this.current = null;
    if (job.timer) clearTimeout(job.timer);
    job.settle(raw);
    this.pump();
  }

  private timeOut(job: Job): void {
    const waitedMs = performance.now() - job.enqueuedAt;
    if (job === this.current) {
      this.abandoned.add(job.id);
      this.finishCurrent(lost("timeout", true, waitedMs));
      return;
    }
    const at = this.queue.indexOf(job);
    if (at !== -1) this.queue.splice(at, 1);
    job.settle(lost("timeout", false, waitedMs));
  }

  private onLine(text: string, arrivedAt: number): void {
    const parsed = parseResponseLine(text);
    if (parsed.kind !== "response") {
      this.breakWithProtocolError();
      return;
    }
    const { value } = parsed;
    const job = this.current;
    if (job && (value.id === job.id || value.id === "")) {
      this.finishCurrent({ kind: "answered", response: value, rttMs: arrivedAt - job.sentAt });
    } else if (!this.abandoned.delete(value.id)) {
      this.breakWithProtocolError();
    }
  }

  private breakWithProtocolError(): void {
    this.close("protocol");
    this.lifecycle.finish("reset");
  }

  private onEnd(cause: EndCause): void {
    if (cause === "too-long") {
      this.breakWithProtocolError();
      return;
    }
    this.socketEnded = true;
    this.lifecycle.resetUnlessHostClosing();
  }

  private failAll(reason: LostReason): void {
    const now = performance.now();
    const running = this.current;
    this.current = null;
    if (running) {
      if (running.timer) clearTimeout(running.timer);
      running.settle(lost(reason, true, now - running.enqueuedAt));
    }
    for (const job of this.queue.splice(0)) {
      if (job.timer) clearTimeout(job.timer);
      job.settle(lost(reason, false, now - job.enqueuedAt));
    }
  }
}

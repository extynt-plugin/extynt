// One accepted connection. Like the real plugin it handles one line at a time and does not read the next line until the
// answer to the previous one has been written, so a delayed or stalled reply blocks that connection only.
import { decodeJson } from "@extynt/decode";
import type { Socket } from "node:net";
import { MAX_REQUEST_BYTES, createLineSplitter } from "@extynt/host-native";
import type { WireError, WireTiming } from "@extynt/host-native";
import { requestBody } from "./request.js";
import { settle, sleep } from "./replies.js";
import type { Reply, Settled } from "./replies.js";
import type { FakeRequest } from "./types.js";

const ZERO_TIMING = { queuedMs: 0, walkMs: 0, hashMs: 0, serializeMs: 0, totalMainThreadMs: 0, bytes: 0, getterCalls: 0 };

/** What a session needs from the server that owns it. */
export interface SessionHost {
  readonly token: string;
  readonly requests: FakeRequest[];
  dispatch(request: FakeRequest): Promise<Reply>;
  subscribe(session: Session, request: FakeRequest): Promise<void>;
  forget(session: Session): void;
}

interface Addressed { id: string; op: string }

function successLine(request: Addressed, result: Extract<Settled, { kind: "ok" }>): string {
  const dispatchedBy: WireTiming["dispatchedBy"] = request.op === "ping_direct" ? "socket" : "idle";
  return JSON.stringify({ ok: true, id: request.id, op: request.op, result: result.result, timing: { ...ZERO_TIMING, dispatchedBy, ...result.timing } });
}

function failureLine(request: Addressed, error: WireError): string {
  return JSON.stringify({ ok: false, id: request.id, op: request.op, error });
}

/** One connection of the fake plugin, reading request lines and writing answers and watch events. */
export class Session {
  readonly index: number;
  readonly socket: Socket;
  watching = false;
  private chain: Promise<void> = Promise.resolve();
  private readonly host: SessionHost;

  constructor(socket: Socket, index: number, host: SessionHost) {
    this.socket = socket;
    this.index = index;
    this.host = host;
    const feed = createLineSplitter({
      onLine: (line) => { if (!this.watching) this.chain = this.chain.then(() => this.process(line)); },
      onTooLong: () => this.writeLine(failureLine({ id: "", op: "" }, { code: "REQUEST_TOO_LARGE", message: `line exceeds ${MAX_REQUEST_BYTES} bytes` })),
      maxBytes: MAX_REQUEST_BYTES,
    });
    socket.on("data", feed);
    socket.on("error", () => undefined);
    socket.on("close", () => host.forget(this));
  }

  write(text: string): void {
    if (!this.socket.destroyed) this.socket.write(text);
  }

  closed(): Promise<void> {
    return this.socket.destroyed ? Promise.resolve() : new Promise((resolve) => { this.socket.once("close", () => resolve()); });
  }

  async writeReply(request: Addressed, reply: Reply): Promise<void> {
    const leaf = await settle(reply);
    switch (leaf.kind) {
      case "ok": this.writeLine(successLine(request, leaf)); break;
      case "error": this.writeLine(failureLine(request, leaf.error)); break;
      case "stall": await this.closed(); break;
      case "close": this.socket.destroy(); break;
      case "raw": this.write(leaf.text); break;
      case "chunks": await this.writeChunks(leaf.chunks, leaf.gapMs); break;
    }
  }

  private async writeChunks(chunks: string[], gapMs: number): Promise<void> {
    for (const chunk of chunks) {
      this.write(chunk);
      await sleep(gapMs);
    }
  }

  private writeLine(text: string): void {
    this.write(`${text}\n`);
  }

  private async process(line: string): Promise<void> {
    const decoded = decodeJson(line, requestBody);
    if (!decoded.ok) {
      const problem = decoded.error.expected === "object" ? "The line is not a JSON object." : "The line is not JSON.";
      this.writeLine(failureLine({ id: "", op: "" }, { code: "BAD_JSON", message: problem }));
      return;
    }
    const body = decoded.value;
    const request: FakeRequest = { id: body.id === undefined ? "" : String(body.id), op: body.op ?? "", connection: this.index, body };
    if (body.token !== this.host.token) {
      this.writeLine(failureLine(request, { code: "UNAUTHORIZED", message: "The token is missing or wrong." }));
      return;
    }
    this.host.requests.push(request);
    if (request.op === "watch") await this.host.subscribe(this, request);
    else await this.writeReply(request, await this.host.dispatch(request));
  }
}

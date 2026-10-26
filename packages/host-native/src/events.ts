// Line framing and the watch connection. A LineConnection turns socket bytes into complete NDJSON lines; a
// WatchConnection subscribes with one `watch` request and then carries only event lines (docs/native/protocol.md, 1 and 3.4).
import type { Socket } from "node:net";
import { decode } from "@extynt/decode";
import { parseResponseLine } from "./wire-response.js";
import type { ResponseEnvelope } from "./wire-response.js";
import { watchSubscribed } from "./wire-watch.js";
import type { PluginEvent, WatchSubscribed } from "./wire-watch.js";

const NEWLINE = 0x0a;
/** The longest line accepted without a newline. A response line may carry a whole project, so this bound only stops an endless unterminated line. */
export const MAX_LINE_BYTES = 256 * 1024 * 1024;

export interface SplitterOptions { onLine(line: string): void; onTooLong(): void; maxBytes?: number }

/** Returns a chunk consumer that emits each complete line once, whatever the chunk boundaries; blank lines are dropped. */
export function createLineSplitter(options: SplitterOptions): (chunk: Buffer) => void {
  const limit = options.maxBytes ?? MAX_LINE_BYTES;
  let parts: Buffer[] = [];
  let size = 0;
  return (chunk) => {
    let rest = chunk;
    for (let end = rest.indexOf(NEWLINE); end !== -1; end = rest.indexOf(NEWLINE)) {
      const line = Buffer.concat([...parts, rest.subarray(0, end)]).toString("utf8");
      parts = [];
      size = 0;
      rest = rest.subarray(end + 1);
      if (line !== "" && line !== "\r") options.onLine(line);
    }
    if (rest.length === 0) return;
    parts.push(rest);
    size += rest.length;
    if (size > limit) {
      parts = [];
      size = 0;
      options.onTooLong();
    }
  };
}

export type EndCause = "closed" | "error" | "too-long";
export interface LineHandlers { onLine(line: string, arrivedAtMs: number): void; onEnd(cause: EndCause): void }

/** One socket as lines in and text out. `onEnd` fires once for a remote close or error, never after `destroy()`. */
export class LineConnection {
  private ended = false;
  private readonly socket: Socket;

  constructor(socket: Socket, handlers: LineHandlers) {
    this.socket = socket;
    socket.setNoDelay(true);
    const feed = createLineSplitter({
      onLine: (line) => { if (!this.ended) handlers.onLine(line, performance.now()); },
      onTooLong: () => this.end("too-long", handlers),
    });
    socket.on("data", feed);
    socket.on("error", () => this.end("error", handlers));
    socket.on("close", () => this.end("closed", handlers));
  }

  private end(cause: EndCause, handlers: LineHandlers): void {
    if (this.ended) return;
    this.ended = true;
    this.socket.destroy();
    handlers.onEnd(cause);
  }

  send(text: string): boolean {
    if (this.ended) return false;
    this.socket.write(text);
    return true;
  }

  destroy(): void {
    this.ended = true;
    this.socket.destroy();
  }
}

export type WatchStart =
  | { ok: true; subscribed: WatchSubscribed }
  | { ok: false; code: string; message: string };

/** What a watch connection reports: each event, and once how it ended: `host-closing` after the plugin announced its quit, `reset` when the socket ended otherwise, `protocol` for a line that is neither event nor handshake. */
export interface WatchHooks {
  onEvent(event: PluginEvent): void;
  onEnd(cause: "host-closing" | "reset" | "protocol"): void;
}

export interface WatchRequestLine { id: string; token: string; intervalMs?: number; stillMs?: number }

/** The event-only connection: sends the `watch` request, resolves `started` with the handshake, then routes event lines. */
export class WatchConnection {
  readonly started: Promise<WatchStart>;
  private readonly line: LineConnection;
  private readonly hooks: WatchHooks;
  private live = false;
  private finished = false;
  private settleStart: (start: WatchStart) => void = () => undefined;

  constructor(socket: Socket, request: WatchRequestLine, hooks: WatchHooks) {
    this.hooks = hooks;
    this.started = new Promise((resolve) => { this.settleStart = resolve; });
    this.line = new LineConnection(socket, {
      onLine: (text) => this.onLine(text),
      onEnd: (cause) => this.onEnd(cause),
    });
    this.line.send(`${JSON.stringify({ ...request, op: "watch" })}\n`);
  }

  destroy(): void {
    this.finished = true;
    this.line.destroy();
    this.settleStart({ ok: false, code: "CLOSED", message: "The watch connection was closed before it subscribed." });
  }

  private onLine(text: string): void {
    const parsed = parseResponseLine(text);
    if (parsed.kind === "event" && this.live) this.deliver(parsed.value);
    else if (parsed.kind === "response" && !this.live) this.handshake(parsed.value);
    else this.fail(`Unexpected line on the watch connection: ${text.slice(0, 120)}`);
  }

  private handshake(response: ResponseEnvelope): void {
    if (!response.ok) {
      this.settleStart({ ok: false, code: response.error.code, message: response.error.message });
      this.finish("reset");
      return;
    }
    const subscribed = decode(watchSubscribed, response.result);
    if (!subscribed.ok) {
      this.fail("The watch response was not a subscription.");
      return;
    }
    this.live = true;
    this.settleStart({ ok: true, subscribed: subscribed.value });
  }

  private deliver(event: PluginEvent): void {
    this.hooks.onEvent(event);
    if (event.event === "host-closing") this.finish("host-closing");
  }

  private onEnd(cause: EndCause): void {
    this.settleStart({ ok: false, code: "CONNECT_FAILED", message: `The watch connection ended before it subscribed (${cause}).` });
    this.finish(cause === "too-long" ? "protocol" : "reset");
  }

  private fail(message: string): void {
    this.settleStart({ ok: false, code: "PROTOCOL", message });
    this.finish("protocol");
  }

  private finish(cause: "host-closing" | "reset" | "protocol"): void {
    if (this.finished) return;
    this.finished = true;
    this.line.destroy();
    if (this.live) this.hooks.onEnd(cause);
  }
}

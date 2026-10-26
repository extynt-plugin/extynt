/** A fake native plugin server and canned responses for the native-spike tests. */
import net from "node:net";
import { decode, jsonObject, object, string } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

const REQUEST_HEAD = object({ id: string(), token: string(), op: string() });

/** A request the fake server received: the parsed line, with its id, token and op typed. */
export type FakeRequest = JsonObject & { readonly id: string; readonly token: string; readonly op: string };

/** Hang up instead of answering. */
export interface Hangup { readonly close: true }

/** Answer with literal bytes. */
export interface RawBytes { readonly raw: string }

/** Answer with one response line split across several writes. */
export interface Chunked { readonly chunks: ReadonlyArray<string> }

/** Answer with `response` after `delayMs`. */
export interface Delayed { readonly delayMs: number; readonly response: JsonObject }

/** What a handler may return: a response object, or one of the scripted misbehaviours. */
export type FakeReply = Hangup | RawBytes | Chunked | Delayed | JsonObject;

/** Decides how the fake server answers one request. */
export type FakeHandler = (request: FakeRequest) => FakeReply;

/** A running fake server: its port, the requests it saw, and a way to stop it. */
export interface FakeServer {
  readonly port: number;
  readonly requests: FakeRequest[];
  readonly close: () => Promise<void>;
}

function readRequest(line: string): FakeRequest {
  const row = decode(jsonObject, JSON.parse(line));
  const head = row.ok ? decode(REQUEST_HEAD, row.value) : null;
  if (!row.ok || !head?.ok) throw new Error(`fake server received a line that is not a request: ${line}`);
  return { ...row.value, ...head.value };
}

/**
 * A stand-in for the native plugin: newline-delimited JSON on a loopback port.
 * handler(request) returns a response object, or {raw} for literal bytes, {chunks} for a response split across
 * writes, {delayMs, response} to answer late, or {close:true} to hang up. Parsed requests are kept in `requests`.
 */
export async function startFakeServer(handler: FakeHandler): Promise<FakeServer> {
  const requests: FakeRequest[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      let end = buffered.indexOf("\n");
      for (; end !== -1; end = buffered.indexOf("\n")) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        answer(socket, line, handler, requests);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the fake server has no port");
  return {
    port: address.port,
    requests,
    close: () => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}

function answer(socket: net.Socket, line: string, handler: FakeHandler, requests: FakeRequest[]): void {
  const request = readRequest(line);
  requests.push(request);
  reply(socket, handler(request));
}

function isHangup(reply: FakeReply): reply is Hangup {
  return "close" in reply && reply.close === true;
}

function isRaw(reply: FakeReply): reply is RawBytes {
  return "raw" in reply && typeof reply.raw === "string";
}

function isChunked(reply: FakeReply): reply is Chunked {
  return "chunks" in reply && Array.isArray(reply.chunks);
}

function isDelayed(reply: FakeReply): reply is Delayed {
  return "delayMs" in reply && typeof reply.delayMs === "number";
}

function reply(socket: net.Socket, answer: FakeReply): void {
  if (isHangup(answer)) { socket.destroy(); return; }
  if (isRaw(answer)) { socket.write(answer.raw); return; }
  if (isChunked(answer)) { writeChunks(socket, answer.chunks); return; }
  if (isDelayed(answer)) { writeLater(socket, answer); return; }
  socket.write(`${JSON.stringify(answer)}\n`);
}

function writeLater(socket: net.Socket, answer: Delayed): void {
  setTimeout(() => socket.write(`${JSON.stringify(answer.response)}\n`), answer.delayMs);
}

function writeChunks(socket: net.Socket, chunks: ReadonlyArray<string>): void {
  chunks.forEach((chunk, index) => setTimeout(() => socket.write(chunk), index * 5));
}

/** Timing figures that are all zero. */
export const ZERO_TIMING: JsonObject = { queuedMs: 0, walkMs: 0, hashMs: 0, serializeMs: 0, totalMainThreadMs: 0, bytes: 0, getterCalls: 0 };

/** A successful response to a request. */
export function okResponse(request: FakeRequest, result: JsonValue = {}, timing: JsonObject = ZERO_TIMING): JsonObject {
  return { ok: true, id: request.id, op: request.op, result, timing };
}

/** A failed response to a request. */
export function errorResponse(request: FakeRequest, code: string, message: string): JsonObject {
  return { ok: false, id: request.id, op: request.op, error: { code, message } };
}

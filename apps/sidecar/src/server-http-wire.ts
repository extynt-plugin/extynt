// The small HTTP primitives the edge shares: loopback and header checks, the error envelope, the JSON writer, the bounded body reader and the diagnostic names of a request.
import type { IncomingMessage, ServerResponse } from "node:http";

import { isDiagnosticRoute, type DiagnosticMethod, type DiagnosticRoute } from "./diagnostics.js";
import type { Opaque } from "./snapshot-view.js";

/** Whether the peer address is this machine. */
export function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** A header value that is a safe identifier, or null. */
export function headerId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : null;
}

/** The method name diagnostics record for a request. */
export function diagnosticMethod(method: string | undefined): DiagnosticMethod {
  return method === "GET" || method === "POST" || method === "OPTIONS" ? method : "OTHER";
}

/** The route name diagnostics record for a path. */
export function diagnosticRoute(pathname: string): DiagnosticRoute {
  if (isDiagnosticRoute(pathname) && pathname !== "/read-only-mutation" && pathname !== "/unknown") return pathname;
  if (pathname === "/execute" || pathname === "/mutate" || pathname === "/v1/execute") return "/read-only-mutation";
  return "/unknown";
}

/** Reads a request body as text, failing once it passes `maxBytes`. */
export function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (error: Error) => { if (!settled) { settled = true; request.resume(); reject(error); } };
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) fail(new Error(`Request body exceeds ${maxBytes} bytes.`));
      else chunks.push(buffer);
    });
    request.on("end", () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString("utf8")); } });
    request.on("error", (error) => fail(error));
  });
}

/** The standard error answer. */
export function errorEnvelope(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

/** Writes a JSON answer unless the client has already gone. */
export function writeJson(response: ServerResponse, statusCode: number, value: Opaque): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = statusCode;
  response.end(JSON.stringify(value));
}

/** Resolves after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// An HTTP request with headers `fetch` will not let a caller set, such as Host; used by the server tests.
import { request } from "node:http";

interface RawRequest { method: string; path: string; headers: Record<string, string> }

/** Sends the request to the local port and resolves with the status and body text. */
export function rawRequest(port: number, spec: RawRequest): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, method: spec.method, path: spec.path, headers: spec.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

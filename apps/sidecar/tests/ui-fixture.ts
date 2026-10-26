/** Shared harness for the UI tests: a sidecar over a fixture UI directory, raw HTTP requests, and an SSE reader. */
import type { JsonValue } from "@extynt/decode";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadOnlySidecar } from "../src/server.js";
import { parseJson } from "./http-json.js";
import { authorization, sidecarForPlugin, token } from "./sidecar-fixture.js";

export const BUILD_LINE = "/* extynt-panel-build:0123456789abcdef */";

export function fixtureUiDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "ae-ui-"));
  for (const directory of ["styles/components", "fonts"]) mkdirSync(join(root, directory), { recursive: true });
  const files: Record<string, string> = {
    "index.html": "<!doctype html><title>extynt</title>", "main.js": `${BUILD_LINE}\nconsole.log(1);\n`, "ui-manifest.json": "{\"files\":[]}",
    "gallery.html": "<!doctype html>gallery", "styles/app.css": "body{}", "styles/components/button.css": ".b{}", "fonts/inter.woff2": "font-bytes", "secret.txt": "top secret",
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

export interface UiHarness { sidecar: ReadOnlySidecar; port: number; uiDirectory: string; stateDirectory: string }

export async function startUiSidecar(t: { after: (fn: () => void | Promise<void>) => void }): Promise<UiHarness> {
  const uiDirectory = fixtureUiDirectory();
  const sidecar = sidecarForPlugin({ port: 0, token, panelSessionId: "panel-ui", uiDirectory });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  return { sidecar, port: address.port, uiDirectory, stateDirectory: sidecar.options.stateDirectory ?? "" };
}

export interface RawResponse { status: number; headers: IncomingHttpHeaders; text: string }
export interface RawRequest { method?: string; path: string; headers?: Record<string, string>; body?: string; authorized?: boolean }

/** The path goes on the wire exactly as written, and the Host header can be overridden. */
export function raw(port: number, input: RawRequest): Promise<RawResponse> {
  const headers = { ...(input.authorized ? authorization : {}), ...input.headers };
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, method: input.method ?? "GET", path: input.path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    outgoing.on("error", reject);
    outgoing.end(input.body);
  });
}

export interface SseFrame { event: string; data: JsonValue }

function frameOf(block: string): SseFrame | undefined {
  let event = "", data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data = line.slice(6);
  }
  if (!event) return undefined;
  return { event, data: parseJson(data) };
}

export interface SseClient { status: number; headers: IncomingHttpHeaders; raw: () => string; frames: SseFrame[]; ended: Promise<void>; close: () => void; waitFor: (test: (frame: SseFrame) => boolean, ms?: number) => Promise<SseFrame> }

/** Opens a stream with the bearer token and parses frames as they arrive. */
export function openSse(port: number, path = "/v1/ui/events"): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, headers: authorization }, (response) => {
      let text = "", consumed = 0;
      const frames: SseFrame[] = [];
      const ended = new Promise<void>((done) => { response.on("close", done); });
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        text += chunk;
        for (let end = text.indexOf("\n\n", consumed); end >= 0; end = text.indexOf("\n\n", consumed)) {
          const frame = frameOf(text.slice(consumed, end));
          if (frame) frames.push(frame);
          consumed = end + 2;
        }
      });
      const waitFor = async (test: (frame: SseFrame) => boolean, ms = 3000): Promise<SseFrame> => {
        const deadline = Date.now() + ms;
        for (;;) {
          const found = frames.find(test);
          if (found) return found;
          if (Date.now() > deadline) throw new Error("timed out waiting for an SSE frame");
          await new Promise((wake) => setTimeout(wake, 10));
        }
      };
      resolve({ status: response.statusCode ?? 0, headers: response.headers, raw: () => text, frames, ended, close: () => outgoing.destroy(), waitFor });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

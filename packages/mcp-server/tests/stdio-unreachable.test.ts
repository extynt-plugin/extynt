// Proves the stdio launcher answers a tool call to a sidecar that drops every connection with a SIDECAR_UNREACHABLE tool result rather than a JSON-RPC error.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { arrayAt, booleanAt, objectAt, objectsIn, stringAt } from "../src/json.js";
import { callSidecar } from "../src/sidecar-client.js";
import { jsonObjectFrom } from "./support/protocol-views.js";

async function silentSidecar(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((socket) => { socket.destroy(); });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { port, close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }) };
}

test("stdio launcher answers a tools/call to an unanswering sidecar with a SIDECAR_UNREACHABLE tool result", async () => {
  const sidecar = await silentSidecar();
  const port = sidecar.port;
  const entry = fileURLToPath(new URL("../src/stdio.js", import.meta.url));
  const child = spawn(process.execPath, [entry], { env: { ...process.env, EXTYNT_ENDPOINT: `http://127.0.0.1:${port}`, AE_BRIDGE_TOKEN: "t" }, stdio: ["pipe", "pipe", "ignore"] });
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ae_status", arguments: {} } })}\n`);
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("no response")); }, 15000);
      child.stdout.once("data", (chunk: Buffer) => { clearTimeout(timer); resolve(chunk.toString("utf8")); });
    });
    const frame = jsonObjectFrom(line.trim());
    assert.equal("error" in frame, false, "must be a tool result, not a JSON-RPC error");
    const result = objectAt(frame, "result");
    assert.equal(booleanAt(result, "isError"), true);
    const text = stringAt(objectsIn(arrayAt(result, "content"))[0], "text");
    assert.match(text ?? "", /SIDECAR_UNREACHABLE/);
    assert.match(text ?? "", /not reachable/);
  } finally {
    child.kill();
    await sidecar.close();
  }
});

test("a mutating call refused before delivery is retried once and answers SIDECAR_UNREACHABLE, not SIDECAR_RESPONSE_LOST, without a socket", async () => {
  const attempts: string[] = [];
  const refused = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" }) });
  const result = await callSidecar("ae_propose_plan", {}, {
    environment: { EXTYNT_ENDPOINT: "http://127.0.0.1:9", AE_BRIDGE_TOKEN: "t" },
    readSession: () => undefined,
    fetch: async (url) => { attempts.push(url); throw refused(); },
    sleep: async () => {},
  });
  assert.equal(attempts.length, 2, "an undelivered call is attempted again once");
  assert.equal(stringAt(objectAt(result, "error"), "code"), "SIDECAR_UNREACHABLE");
  assert.equal(booleanAt(result, "ok"), false);
});

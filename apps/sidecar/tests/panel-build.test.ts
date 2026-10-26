/** /health reports the build of the panel that is paired, remembered from the panel's own requests. */
import { fieldOf, readJson } from "./http-json.js";
import { authorization, sidecarFor, token } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

const BUILD_A = "0123456789abcdef", BUILD_B = "fedcba9876543210", BUILD_C = "aaaaaaaaaaaaaaaa";

async function start(t: { after: (fn: () => void | Promise<void>) => void }) {
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers: { ...authorization, ...headers } });
  const reported = async (headers: Record<string, string> = {}) => fieldOf(await readJson(await get("/health", headers)), "panelBuild");
  return { get, reported };
}

test("the panel's build is remembered from its own requests, not read from /health", async (t) => {
  const h = await start(t);
  assert.equal(await h.reported(), null, "no panel has said anything");
  await h.get("/v1/pair", { "X-AE-Panel-Instance": "panel-a", "X-AE-Panel-Build": BUILD_A });
  assert.equal(await h.reported(), BUILD_A, "curl and the MCP send no header and still see the panel's build");
  await h.get("/v1/snapshots/latest", { "X-AE-Panel-Instance": "panel-a", "X-AE-Panel-Build": BUILD_B });
  assert.equal(await h.reported(), BUILD_B, "any request from the paired panel keeps it current");
});

test("only the paired panel instance can change the build; a new instance starts from its own", async (t) => {
  const h = await start(t);
  await h.get("/v1/pair", { "X-AE-Panel-Instance": "panel-a", "X-AE-Panel-Build": BUILD_A });
  await h.get("/v1/snapshots/latest", { "X-AE-Panel-Build": BUILD_B });
  assert.equal(await h.reported(), BUILD_A, "a request with no instance header (curl) changes nothing");
  await h.get("/v1/snapshots/latest", { "X-AE-Panel-Instance": "panel-old", "X-AE-Panel-Build": BUILD_B });
  assert.equal(await h.reported(), BUILD_A, "a stale instance changes nothing");
  await h.get("/v1/pair", { "X-AE-Panel-Instance": "panel-b" });
  assert.equal(await h.reported(), null, "a new instance that has not named its build does not inherit the last one's");
  await h.get("/v1/pair", { "X-AE-Panel-Instance": "panel-b", "X-AE-Panel-Build": BUILD_C });
  assert.equal(await h.reported(), BUILD_C);
});

test("the header on /health itself still answers when nothing has been remembered", async (t) => {
  const h = await start(t);
  assert.equal(await h.reported({ "X-AE-Panel-Build": BUILD_A }), BUILD_A);
  await h.get("/v1/pair", { "X-AE-Panel-Instance": "panel-a", "X-AE-Panel-Build": BUILD_B });
  assert.equal(await h.reported({ "X-AE-Panel-Build": BUILD_A }), BUILD_B, "what the panel itself said wins");
});

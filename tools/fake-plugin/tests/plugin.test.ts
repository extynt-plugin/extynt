/** Tests the fake plugin's discovery file and its lifecycle. */
import assert from "node:assert/strict";
import net from "node:net";
import { tmpdir } from "node:os";
import test from "node:test";
import { boolean, decodeOrThrow, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { readPluginEndpoint } from "@extynt/host-native";
import { startFakePlugin } from "../src/index.js";
import { until, withRig } from "./rig.js";

const answerLine = object({ ok: boolean(), id: string(), error: optional(object({ code: string(), message: string() })) });

async function exchange(port: number, lines: string[]): Promise<Array<Infer<typeof answerLine>>> {
  const socket = net.createConnection({ port, host: "127.0.0.1" });
  const received: string[] = [];
  let buffered = "";
  socket.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
    const parts = buffered.split("\n");
    buffered = parts.pop() ?? "";
    received.push(...parts);
  });
  await new Promise<void>((resolve) => { socket.once("connect", () => resolve()); });
  for (const line of lines) socket.write(`${line}\n`);
  await until(() => received.length >= lines.length);
  socket.destroy();
  return received.map((text) => decodeOrThrow(answerLine, JSON.parse(text)));
}

test("startFakePlugin writes a discovery file the client can read, and removes it on close", async () => {
  await withRig(async ({ plugin, directory }) => {
    const found = readPluginEndpoint(`${directory}/native.json`);
    assert.deepEqual(found.ok && [found.endpoint.port, found.endpoint.token], [plugin.port, plugin.token]);
    await plugin.close();
    assert.equal(readPluginEndpoint(`${directory}/native.json`).ok, false);
  });
});

test("writeDiscovery false leaves the state directory empty until asked", async () => {
  await withRig(async ({ plugin, directory }) => {
    assert.equal(readPluginEndpoint(`${directory}/native.json`).ok, false);
    plugin.writeDiscovery();
    assert.equal(readPluginEndpoint(`${directory}/native.json`).ok, true);
  }, { plugin: { writeDiscovery: false } });
});

test("the plugin rejects a wrong token, bad JSON, unknown ops and disallowed host entries with the protocol codes", async () => {
  await withRig(async ({ plugin }) => {
    const { token } = plugin;
    const answers = await exchange(plugin.port, [
      JSON.stringify({ id: "1", token: "no", op: "ping" }),
      "{not json",
      JSON.stringify({ id: 3, token, op: "frobnicate" }),
      JSON.stringify({ id: "4", token, op: "host_call", entry: "evil", args: "{}" }),
      JSON.stringify({ id: "5", token, op: "host_call", entry: "aeApplyPlan", args: "[1]" }),
    ]);
    const codes = answers.map((answer) => answer.error?.code);
    assert.deepEqual(codes, ["UNAUTHORIZED", "BAD_JSON", "UNKNOWN_OP", "ENTRY_NOT_ALLOWED", "BAD_REQUEST"]);
    assert.equal(answers[2]?.id, "3");
  });
});

test("batch rejects ops that are not allowed inside it and nesting, naming the entry", async () => {
  await withRig(async ({ plugin }) => {
    const { token } = plugin;
    const answers = await exchange(plugin.port, [
      JSON.stringify({ id: "1", token, op: "batch", ops: [{ op: "ping" }, { op: "ping_direct" }] }),
      JSON.stringify({ id: "2", token, op: "batch", ops: [{ op: "batch", ops: [] }] }),
      JSON.stringify({ id: "3", token, op: "batch", ops: [] }),
    ]);
    assert.deepEqual(answers.map((answer) => answer.ok), [false, false, false]);
    assert.match(JSON.stringify(answers[0]), /ops\[1\]/);
  });
});

test("read_paths reports per-target errors without failing the response", async () => {
  await withRig(async ({ client }) => {
    const outcome = await client.request<{ results: Array<{ found: boolean; error?: string }> }>({
      op: "read_paths",
      targets: [
        { compId: "5", layerId: "11", path: "ADBE Transform Group/ADBE Opacity" },
        { compId: "5", layerId: "11", path: "nope" },
        { compId: "5", layerId: "99", path: "x" },
        { compId: "9", layerId: "11", path: "x" },
      ],
    });
    assert.equal(outcome.kind, "ok");
    if (outcome.kind === "ok") assert.deepEqual(outcome.result.results.map((entry) => entry.error ?? "found"), ["found", "PATH_NOT_FOUND", "LAYER_NOT_FOUND", "COMP_NOT_FOUND"]);
  });
});

test("read_project, read_comp and watch_state answer from the fixture and the watch state", async () => {
  await withRig(async ({ client, plugin }) => {
    const project = await client.request<{ itemCount: number; itemsHash?: string }>({ op: "read_project", hashes: true });
    assert.deepEqual(project.kind === "ok" && [project.result.itemCount, typeof project.result.itemsHash], [3, "string"]);
    const comp = await client.request<{ compositions: Array<{ id: string }> }>({ op: "read_comp", compId: "5" });
    assert.equal(comp.kind === "ok" && comp.result.compositions.length, 1);
    plugin.change({ revision: 777 });
    const state = await client.request<{ revision: number }>({ op: "watch_state" });
    assert.equal(state.kind === "ok" && state.result.revision, 777);
  });
});

test("dropConnections targets requesters or watchers only", async () => {
  await withRig(async ({ client, plugin, closes }) => {
    assert.equal(plugin.watcherCount, 1);
    plugin.dropConnections("watchers");
    await until(() => closes.length === 1);
    assert.equal((await client.pingDirect()).kind, "lost");
  });
});

test("an oversized request line is answered REQUEST_TOO_LARGE", async () => {
  const directory = tmpdir();
  const plugin = await startFakePlugin({ stateDirectory: directory, writeDiscovery: false });
  try {
    const socket = net.createConnection({ port: plugin.port, host: "127.0.0.1" });
    const received: string[] = [];
    socket.on("data", (chunk) => received.push(chunk.toString("utf8")));
    await new Promise<void>((resolve) => { socket.once("connect", () => resolve()); });
    socket.write("x".repeat(17 * 1024 * 1024));
    await until(() => received.join("").includes("REQUEST_TOO_LARGE"));
    socket.destroy();
  } finally {
    await plugin.close();
  }
});

test("requests are checked as the plugin checks them: integer ids, integer watch intervals, required targets", async () => {
  await withRig(async ({ plugin }) => {
    const { token } = plugin;
    const lines = [
      { id: "1", token, op: "read_comp" },
      { id: "2", token, op: "read_comp", compId: 5 },
      { id: "3", token, op: "read_comp", compId: 5.5 },
      { id: "4", token, op: "effect_menus", compId: "5" },
      { id: "5", token, op: "read_paths", targets: [{ compId: "5", layerId: "11" }] },
      { id: "6", token, op: "read_paths", targets: [] },
      { id: "7", token, op: "watch", intervalMs: 100.5 },
      { id: "8", token, op: "watch", stillMs: "300" },
    ];
    const answers = await exchange(plugin.port, lines.map((line) => JSON.stringify(line)));
    const verdicts = answers.map((answer) => (answer.ok ? "ok" : answer.error?.code));
    assert.deepEqual(verdicts, ["BAD_REQUEST", "ok", "BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST"]);
  });
});

test("a target that is not an object, or lacks a field, is refused with the plugin's message", async () => {
  await withRig(async ({ plugin }) => {
    const { token } = plugin;
    const bad = [["x"], [7], [null], [{ compId: "5", layerId: "11" }], [{ compId: "5", layerId: "11", path: "" }]];
    const lines = bad.map((targets, index) => JSON.stringify({ id: String(index), token, op: "read_paths", targets }));
    const answers = await exchange(plugin.port, lines);
    assert.deepEqual(answers.map((answer) => answer.error?.message), bad.map(() => "each target needs compId, layerId and a non-empty path"));
  });
});

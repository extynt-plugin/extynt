/** The native host path has no polling and no settle waits: no 1 s timers, no STABLE_MS or PAGE_GAP_MS, and an idle lane sends the plugin nothing. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { READ_COALESCE_MS, EVENT_STAMP_TTL_MS } from "../src/host/events.js";
import { startHostRig } from "./host-rig.js";

const here = dirname(fileURLToPath(import.meta.url));
const sources = join(here, "..", "..", "src");
const HOST_DIRECTORY = join(sources, "host");
const SCHEDULER_FILES = ["read-scheduler.ts", "read-queue.ts", "apply-read-spec.ts", "composition-gate.ts"].map((name) => join(sources, name));
const CONNECTION_FILES = new Set(["link.ts", "lane.ts"]);

const hostFiles = readdirSync(HOST_DIRECTORY).filter((name) => name.endsWith(".ts")).map((name) => join(HOST_DIRECTORY, name));
const nativeFiles = [...hostFiles, ...SCHEDULER_FILES];

function read(path: string): string { return readFileSync(path, "utf8"); }
const nameOf = (path: string): string => path.slice(sources.length + 1);

test("no file of the native path uses setInterval, STABLE_MS or PAGE_GAP_MS", () => {
  for (const path of nativeFiles) {
    const text = read(path);
    assert.doesNotMatch(text, /\bsetInterval\s*\(/, `${nameOf(path)} polls`);
    assert.doesNotMatch(text, /\bSTABLE_MS\b|\bPAGE_GAP_MS\b|\bsettleMs\b/, `${nameOf(path)} waits for a settle`);
  }
});

test("no timer in the native path is as long as one second, and no waiting constant is", () => {
  for (const path of nativeFiles.filter((file) => !CONNECTION_FILES.has(file.slice(HOST_DIRECTORY.length + 1)))) {
    const text = read(path);
    for (const match of text.matchAll(/\b(?:setTimeout|pause|timers\.set)\s*\([^)]*?\b(\d[\d_]*)\s*\)/g)) assert.ok(Number(String(match[1]).replaceAll("_", "")) < 1000, `${nameOf(path)}: a timer of ${match[1]} ms`);
    for (const match of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*_MS)\s*=\s*([\d_]+)/g)) {
      if (!/TIMEOUT|TTL|REASK|MAX_AGE/.test(String(match[1]))) assert.ok(Number(String(match[2]).replaceAll("_", "")) < 1000, `${nameOf(path)}: ${match[1]} is ${match[2]} ms`);
    }
  }
});

test("the windows the native path does use are short", () => {
  assert.ok(READ_COALESCE_MS < 1000 && READ_COALESCE_MS >= 50);
  assert.ok(EVENT_STAMP_TTL_MS >= 2 * 1000, "the stamp outlives two stills (the plugin's still window is 1 s)");
});

test("the native lane lists the host files this card owns, so the scan above is not scanning nothing", () => {
  const names = hostFiles.map((path) => path.slice(HOST_DIRECTORY.length + 1));
  for (const expected of ["events.ts", "run-read.ts", "run-capture.ts", "run-census.ts", "run-catalogue.ts", "run-collection.ts", "run-preview.ts", "readers.ts"]) assert.ok(names.includes(expected), expected);
});

test("an idle native lane sends the plugin nothing: no poll, no ping, no read, for longer than any poll interval it replaced", async () => {
  const rig = await startHostRig({ realTimers: true });
  try {
    rig.pair();
    await rig.settle();
    await rig.drain();
    const quiet = rig.plugin.requests.length;
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    assert.equal(rig.plugin.requests.length, quiet, "events are pushed; nothing asks");
  } finally { await rig.close(); }
});

test("the readers register a runner for each kind they own, and only those", async () => {
  const rig = await startHostRig();
  try {
    const kinds: string[] = [];
    rig.readers.register({ register: (kind) => { kinds.push(kind); } });
    assert.deepEqual(kinds.sort(), ["capture_frame", "catalogue_page", "collection_page", "host_census", "preview_controls", "refresh_snapshot"]);
  } finally { await rig.close(); }
});

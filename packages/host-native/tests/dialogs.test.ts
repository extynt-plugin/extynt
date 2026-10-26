// Tests how the plugin's waiting-dialog report, the census scan and the stall verdict reach callers.
import assert from "node:assert/strict";
import test from "node:test";
import { decode, decodeOrThrow } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { hostCallResult, optionsDialogFlags, pingDirectResult, stallReport, withOptionsDialogFlags } from "../src/index.js";

const TIMING = { queuedMs: 0, walkMs: 0, hashMs: 0, serializeMs: 0, totalMainThreadMs: 0, bytes: 0, getterCalls: 0, dispatchedBy: "socket" } as const;

const ping: JsonObject = {
  pong: true, mainThread: false, pluginVersion: "0.1.0", aeVersion: "26.5.0", pid: 7, arch: "x64", idleAgeMs: 10, idleTicks: 3, queueDepth: 0,
  oldestQueuedMs: null, watchers: 0, library: { version: null, entryFile: null },
};
const hostCall: JsonObject = {
  source: "native", entry: "aeHostCensus", result: "{}", scriptUs: 5, libraryLoaded: true, libraryLoadUs: 1, libraryVersion: "1", projectEpoch: 2,
};

function waitingOnDialog(extra: JsonObject): { title: string; sinceMs: number } | null {
  return decodeOrThrow(pingDirectResult, { ...ping, ...extra }).waitingOnDialog ?? null;
}

test("ping_direct reports the dialog After Effects is waiting on", () => {
  assert.deepEqual(waitingOnDialog({ waitingOnDialog: { title: "Select a LUT file", sinceMs: 2500 } }), { title: "Select a LUT file", sinceMs: 2500 });
});

test("ping_direct reads a null, missing or malformed dialog as no dialog", () => {
  assert.equal(waitingOnDialog({ waitingOnDialog: null }), null);
  assert.equal(waitingOnDialog({}), null);
  assert.equal(waitingOnDialog({ waitingOnDialog: { title: 3, sinceMs: 1 } }), null);
});

test("a stall report carries the dialog and counts as After Effects being busy", () => {
  const result = decodeOrThrow(pingDirectResult, { ...ping, idleAgeMs: 5, waitingOnDialog: { title: "Open", sinceMs: 900 } });
  const report = stallReport({ kind: "ok", result, timing: TIMING, rttMs: 1 }, 2100);
  assert.deepEqual(report.dialog, { title: "Open", sinceMs: 900 });
  assert.equal(report.verdict, "ae-busy");
});

test("a stall report for a lost ping has no dialog and calls the plugin unresponsive", () => {
  const report = stallReport({ kind: "lost", reason: "timeout", sent: true, waitedMs: 10 }, 10);
  assert.equal(report.dialog, null);
  assert.equal(report.verdict, "plugin-unresponsive");
});

test("the census scan decodes entry by entry", () => {
  const scan = [{ matchName: "ADBE Numbers", hasOptionsDialog: true }, { matchName: "ADBE Blur", hasOptionsDialog: false }];
  assert.deepEqual(decodeOrThrow(hostCallResult, { ...hostCall, optionsDialogScan: scan }).optionsDialogScan, scan);
});

test("the census scan stays absent when the plugin sent none or sent a malformed entry", () => {
  assert.equal(decodeOrThrow(hostCallResult, hostCall).optionsDialogScan, undefined);
  assert.equal(decodeOrThrow(hostCallResult, { ...hostCall, optionsDialogScan: [{ matchName: "x" }] }).optionsDialogScan, undefined);
});

test("a host_call with an unknown entry is rejected", () => {
  assert.equal(decode(hostCallResult, { ...hostCall, entry: "evalScript" }).ok, false);
});

test("withOptionsDialogFlags sets the flag only on scanned effects", () => {
  const flags = optionsDialogFlags({ optionsDialogScan: [{ matchName: "A", hasOptionsDialog: true }, { matchName: "B", hasOptionsDialog: false }] });
  const items = withOptionsDialogFlags([{ matchName: "A" }, { matchName: "B" }, { matchName: "C" }], flags);
  assert.deepEqual(items, [{ matchName: "A", hasOptionsDialog: true }, { matchName: "B", hasOptionsDialog: false }, { matchName: "C" }]);
});

test("no scan gives no flags", () => {
  assert.equal(optionsDialogFlags({}).size, 0);
});

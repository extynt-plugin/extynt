/** Captures of one composition are compared in-session so a reader without eyes sees what an edit changed. */
import assert from "node:assert/strict";
import test from "node:test";
import { compileCaptureCommand } from "@extynt/host-ae";
import { jsonOf } from "@extynt/mcp-server";
import { summarizeFrame } from "@extynt/visual-evidence";
import { compareToEarlierCaptures } from "../src/capture-compare.js";
import type { CaptureRecord } from "../src/server-types.js";

const paint = (cornerRed: boolean): number[] => {
  const out: number[] = [];
  for (let y = 0; y < 60; y += 1) for (let x = 0; x < 60; x += 1) out.push(...(cornerRed && x >= 40 && y < 20 ? [200, 40, 40, 255] : [0, 0, 0, 255]));
  return out;
};

function commandFor(compositionId: string, captureId: string): CaptureRecord["request"] {
  const command = compileCaptureCommand({ compositionId, time: 0, width: 60, height: 60, format: "png", shareWithProvider: false }, captureId);
  if (!("operation" in command)) throw new Error(command.message);
  return command;
}

function record(captureId: string, cornerRed: boolean, frameHash: string, compositionId = "comp"): CaptureRecord {
  const summary = summarizeFrame(paint(cornerRed), 60, 60);
  return { captureId, status: "completed", request: commandFor(compositionId, captureId), preview: { maxWidth: 96, maxHeight: 96 }, maxEncodedBytes: 1, receipt: { frameHash, summary: jsonOf(summary) } };
}

test("a later capture reports the cells that changed, and a repeat names the capture it equals", () => {
  const captures = new Map<string, CaptureRecord>([["a", record("a", false, "h1")], ["b", record("b", true, "h2")], ["c", record("c", true, "h2")], ["d", record("d", true, "h3", "other")]]);
  assert.deepEqual(compareToEarlierCaptures(captures, "a"), {});
  const b = compareToEarlierCaptures(captures, "b");
  assert.deepEqual(b.changedFrom?.cells, [2]);
  assert.equal(b.changedFrom?.captureId, "a");
  assert.deepEqual(compareToEarlierCaptures(captures, "c"), { identicalTo: "b" });
  assert.deepEqual(compareToEarlierCaptures(captures, "d"), {}, "another composition is not a baseline");
});

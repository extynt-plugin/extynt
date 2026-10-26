/** A read, a census or a capture that waits on After Effects shows the same stall as an apply does, and clears it when it answers. */
import assert from "node:assert/strict";
import test from "node:test";
import { late, ok, toWire } from "@extynt/fake-plugin";
import type { Handler } from "@extynt/fake-plugin";
import { censusAnswer } from "./sidecar-fixture.js";
import { nativeRig, until } from "./native-rig.js";

test("a read that waits on After Effects shows the link as stalled, and online again once it answers", async (t) => {
  const watchState: Handler = (_request, plugin) => late(900, ok(toWire(plugin.state.watch)));
  const rig = await nativeRig(t, { skipRefresh: true, sidecar: { hostStallAfterMs: 80 }, plugin: { handlers: { watch_state: watchState } } });
  const states: string[] = [];
  rig.sidecar.nativeHost?.link.onChange((status) => { states.push(status.state); });
  await until(() => rig.sidecar.hostLink.status().state === "stalled", 3000);
  await until(() => rig.sidecar.latest !== undefined && rig.sidecar.hostLink.status().state === "online", 5000);
  assert.ok(states.includes("stalled") && states.at(-1) === "online", JSON.stringify(states));
});

test("a census that waits on After Effects shows the stall too", async (t) => {
  const rig = await nativeRig(t, { plugin: { hostCalls: { aeHostCensus: (args) => late(900, ok(toWire(censusAnswer(args, 2)))) } }, sidecar: { hostStallAfterMs: 80 } });
  await until(() => rig.sidecar.hostLink.status().state === "stalled", 3000);
  await until(() => rig.sidecar.hostLink.status().state === "online" && rig.sidecar.inventory !== undefined, 5000);
});

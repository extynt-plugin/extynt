/** A host below the supported floor is refused at connect: the link goes offline with the reason, the connection closes, and nothing retries. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { connectPlugin } from "@extynt/host-native";
import type { ConnectOptions } from "@extynt/host-native";
import { startFakePlugin } from "@extynt/fake-plugin";
import { createHostLink } from "../src/host/link.js";
import { sidecarForPlugin, token } from "./sidecar-fixture.js";

const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

test("a host older than the supported floor is refused with the reason, and the link does not retry", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "link-refusal-")), plugin = await startFakePlugin({ stateDirectory: directory, aeVersion: "24.6.0 (build 100)" });
  const sidecar = sidecarForPlugin({ port: 0, token, discoveryPath: plugin.discoveryPath });
  let connects = 0;
  const connect = (options: ConnectOptions) => { connects += 1; return connectPlugin(options); };
  const link = createHostLink({ state: sidecar, discoveryPath: plugin.discoveryPath, connect, initialBackoffMs: 10, maxBackoffMs: 20 });
  let connected = 0;
  link.onConnected(() => { connected += 1; });
  t.after(async () => { link.stop(); await plugin.close(); rmSync(directory, { recursive: true, force: true }); });
  link.start();
  const deadline = Date.now() + 5000;
  while (connects === 0 && Date.now() < deadline) await pause(10);
  await pause(300);
  const status = link.status();
  assert.equal(status.state, "offline");
  assert.match(status.reason ?? "", /needs After Effects 25 or later/);
  assert.equal(link.client(), undefined);
  assert.equal(connected, 0, "nothing is announced as connected");
  assert.equal(connects, 1, "no retry after a refusal");
});

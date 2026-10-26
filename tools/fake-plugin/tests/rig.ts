// Test rig: a fake plugin in a temp state directory, a connected client, and what the client reported.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginConnectError, connectPlugin } from "@extynt/host-native";
import type { ConnectOptions, PluginClient, PluginEvent } from "@extynt/host-native";
import { startFakePlugin } from "../src/index.js";
import type { FakePlugin, FakePluginOptions } from "../src/index.js";

export interface Rig {
  plugin: FakePlugin;
  client: PluginClient;
  events: PluginEvent[];
  closes: string[];
  directory: string;
}

export async function until(done: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not reached in time");
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

/** Asserts that a connection attempt fails with a PluginConnectError carrying `code`. */
export function rejectsWithCode(attempt: Promise<PluginClient>, code: string): Promise<void> {
  return assert.rejects(attempt, (error: Error) => error instanceof PluginConnectError && error.code === code);
}

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export interface RigOptions { plugin?: Partial<FakePluginOptions>; connect?: Partial<ConnectOptions> }

/** Runs `body` against a fresh plugin and client, and tears everything down afterwards. */
export async function withRig(body: (rig: Rig) => Promise<void>, options: RigOptions = {}): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "extynt-fake-plugin-"));
  const plugin = await startFakePlugin({ stateDirectory: directory, ...options.plugin });
  const events: PluginEvent[] = [];
  const closes: string[] = [];
  const client = await connectPlugin({
    endpoint: plugin.endpoint,
    onEvent: (event) => events.push(event),
    onClose: (reason) => closes.push(reason),
    ...options.connect,
  });
  try {
    await body({ plugin, client, events, closes, directory });
  } finally {
    client.close();
    await plugin.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

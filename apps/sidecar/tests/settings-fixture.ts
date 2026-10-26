// Shared by the model-settings tests: a throwaway settings folder, a sidecar serving a model settings store from it, and a caller for its routes.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { decodeOrThrow } from "@extynt/decode";
import { createModelSettingsStore, type ModelSettingsStore } from "../src/llm-config.js";
import { jsonValue, type JsonValue } from "@extynt/decode";
import { authorization, sidecarFor, token } from "./sidecar-fixture.js";

export interface SettingsAnswer {
  readonly status: number;
  readonly text: string;
  json(): JsonValue;
}

export interface SettingsServer {
  readonly base: string;
  readonly filePath: string;
  readonly store: ModelSettingsStore;
  call(method: string, path: string, body?: JsonValue): Promise<SettingsAnswer>;
}

export interface ServeOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly discoverCapabilities?: boolean;
}

export function settingsFolder(t: TestContext, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `extynt-${prefix}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function storeIn(t: TestContext, env: Readonly<Record<string, string>> = {}): { store: ModelSettingsStore; filePath: string } {
  const filePath = join(settingsFolder(t, "store"), "llm.env");
  return { store: createModelSettingsStore({ filePath, processEnv: env }), filePath };
}

function callerFor(base: string): SettingsServer["call"] {
  return async (method, path, body) => {
    const headers = { ...authorization, "content-type": "application/json" };
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, text, json: () => decodeOrThrow(jsonValue, JSON.parse(text)) };
  };
}

export async function serveSettings(t: TestContext, options: ServeOptions = {}): Promise<SettingsServer> {
  const filePath = join(settingsFolder(t, "settings"), "llm.env");
  const store = createModelSettingsStore({ filePath, processEnv: options.env ?? {}, ...(options.discoverCapabilities ? { discoverCapabilities: true } : {}) });
  const sidecar = sidecarFor({ port: 0, token, modelSettings: store, quietAgentLog: true, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  return { base, filePath, store, call: callerFor(base) };
}

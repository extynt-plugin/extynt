// Reads tool outcomes, MCP results, JSON-RPC frames and tool schemas as JSON objects, and drives the stdio launcher, for the protocol suites.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodeOrThrow, jsonObject, jsonValue } from "@extynt/decode";
import type { Decoder, JsonObject, JsonValue } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot } from "@extynt/project-graph";
import { jsonFieldsOf, objectAt } from "../../src/json.js";
import { parsedJsonObject } from "./narrow.js";
import type { callTool, ToolDefinition } from "../../src/index.js";
import type { callSidecar } from "../../src/sidecar-client.js";
import type { McpToolResult } from "../../src/transport.js";

/** What `callTool` answers. */
export type ToolOutcome = ReturnType<typeof callTool>;

/** What `callSidecar` answers. */
export type SidecarOutcome = Awaited<ReturnType<typeof callSidecar>>;

type ToolAnswered = Extract<ToolOutcome, { ok: true }>;

const STDIO_ENTRYPOINT = fileURLToPath(new URL("../../src/stdio.js", import.meta.url));

/** The answered result of a call; a refusal fails the test with its code and message. */
export function successOf(result: ToolOutcome): ToolAnswered {
  if (!result.ok) throw new Error(`the call was refused: ${result.error.code}: ${result.error.message}`);
  return result;
}

/** The data of an answered call as any JSON value. */
export function successValue(result: ToolOutcome): JsonValue {
  return decodeOrThrow(jsonValue, successOf(result).data);
}

/** The data of an answered call decoded as the given view; data of another shape fails the test. */
export function successView<T>(decoder: Decoder<T>, result: ToolOutcome): T {
  return decodeOrThrow(decoder, successOf(result).data);
}

/** Text parsed as a JSON object; anything else fails the test. */
export function jsonObjectFrom(text: string): JsonObject {
  const parsed = parsedJsonObject(text);
  assert.ok(parsed, `not a JSON object: ${text.slice(0, 80)}`);
  return parsed;
}

/** The text of one content block of an MCP result; an image block fails the test. */
export function mcpText(result: McpToolResult, index = 0): string {
  const block = result.content[index];
  if (block?.type !== "text") throw new Error(`content block ${String(index)} is not text`);
  return block.text;
}

/** The JSON body an MCP result carries in its first text block. */
export function mcpView(result: McpToolResult): JsonObject {
  return jsonObjectFrom(mcpText(result));
}

/** The `data` object of an MCP result's body. */
export function mcpViewData(result: McpToolResult): JsonObject {
  const data = objectAt(mcpView(result), "data");
  assert.ok(data, "the view carries a data object");
  return data;
}

/** The nested object reached by following the keys from the root, or `undefined` when a step is missing. */
export function objectPath(root: JsonObject | undefined, keys: ReadonlyArray<string>): JsonObject | undefined {
  return keys.reduce<JsonObject | undefined>((node, key) => objectAt(node, key), root);
}

/** A tool definition's input schema as a JSON object. */
export function schemaOf(definition: ToolDefinition): JsonObject {
  return jsonFieldsOf(definition.inputSchema);
}

/** One property of a tool definition's input schema. */
export function propertyOf(definition: ToolDefinition, name: string): JsonObject | undefined {
  return objectPath(schemaOf(definition), ["properties", name]);
}

/** The named definition from a tool list; a missing one fails the test. */
export function toolNamed(tools: ReadonlyArray<ToolDefinition>, name: string): ToolDefinition {
  const found = tools.find((tool) => tool.name === name);
  assert.ok(found, `${name} is declared`);
  return found;
}

/** The first composition of a snapshot (the representative one by default) and its first layer. */
export function baseLayer(snapshot: ProjectSnapshot = representativeSnapshot): { readonly composition: CompositionSnapshot; readonly layer: LayerSnapshot } {
  const composition = snapshot.compositions[0];
  const layer = composition?.layers[0];
  assert.ok(composition && layer, "the representative snapshot has a layer");
  return { composition, layer };
}

/** What a stdio launcher printed and how it ended. */
export interface StdioRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the stdio launcher on the requests, one per line, and waits for it to end. */
export async function runStdio(requests: ReadonlyArray<JsonObject>): Promise<StdioRun> {
  const child = spawn(process.execPath, [STDIO_ENTRYPOINT], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.end(requests.map((request) => `${JSON.stringify(request)}\n`).join(""));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { exitCode, stdout, stderr };
}

/** The JSON-RPC frames a stdio run printed, one per line. */
export function framesOf(run: StdioRun): ReadonlyArray<JsonObject> {
  return run.stdout.trim().split("\n").map((line) => jsonObjectFrom(line));
}

/** The `error` object of a sidecar call that failed; a call that answered fails the test. */
export function sidecarError(result: SidecarOutcome): JsonObject {
  const error = objectAt(decodeOrThrow(jsonObject, result), "error");
  assert.ok(error, "the sidecar call failed with an error object");
  return error;
}

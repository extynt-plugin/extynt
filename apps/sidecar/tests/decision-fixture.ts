// Shared by the decision-model tests: a sidecar over a throwaway llm.env, a caller for its routes and the open key page, and what it published or logged.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createDecisionSettings } from "../src/decision-settings-service.js";
import type { DiagnosticEvent } from "../src/diagnostics.js";
import type { UiEvent } from "../src/ui-contract.js";
import { uiEventsFor } from "../src/ui-events.js";
import { authorization, sidecarFor, token } from "./sidecar-fixture.js";

export type DecisionEvent = Extract<UiEvent, { type: "decision" }>;

export interface DecisionAnswer {
  readonly status: number;
  readonly text: string;
}

export interface DecisionRig {
  readonly filePath: string;
  readonly events: ReadonlyArray<DecisionEvent>;
  readonly logs: ReadonlyArray<string>;
  readonly base: string;
  call(method: string, path: string, body?: string): Promise<DecisionAnswer>;
  open(method: string, path: string, init?: { readonly body?: string; readonly headers?: Readonly<Record<string, string>> }): Promise<DecisionAnswer>;
  tool(args: string): Promise<DecisionAnswer>;
}

export interface DecisionRigOptions {
  readonly processEnv?: Readonly<Record<string, string>>;
  readonly modelAnswers?: boolean;
}

const ANSWERING = JSON.stringify({ model: "jev-latest", answers: { probe: { type: "noul", noul: 0.1, certainty: "high" } }, usage: { input_tokens: 1, output_tokens: 1 }, request_id: "r1" });
const answeringFetch: typeof globalThis.fetch = async () => new Response(ANSWERING, { status: 200, headers: { "content-type": "application/json" } });
const rejectingFetch: typeof globalThis.fetch = async () => new Response("key rejected", { status: 401 });

async function answerOf(response: Response): Promise<DecisionAnswer> {
  return { status: response.status, text: await response.text() };
}

export async function decisionRig(t: TestContext, options: DecisionRigOptions = {}): Promise<DecisionRig> {
  const folder = mkdtempSync(join(tmpdir(), "extynt-decision-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filePath = join(folder, "llm.env");
  const decisionSettings = createDecisionSettings({ sources: { filePath, processEnv: options.processEnv ?? {} }, displayPath: "llm.env", fetch: options.modelAnswers === true ? answeringFetch : rejectingFetch });
  const logs: string[] = [];
  const diagnostics = { enabled: true, logger: (event: DiagnosticEvent) => { logs.push(JSON.stringify(event)); } };
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true, decisionSettings, diagnostics });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const events: DecisionEvent[] = [];
  uiEventsFor(sidecar).subscribe((event) => { if (event.type === "decision") events.push(event); });
  const base = `http://${address.host}:${address.port}`;
  const call: DecisionRig["call"] = async (method, path, body) =>
    answerOf(await fetch(`${base}${path}`, { method, headers: { ...authorization, "content-type": "application/json" }, ...(body === undefined ? {} : { body }) }));
  const open: DecisionRig["open"] = async (method, path, init = {}) =>
    answerOf(await fetch(`${base}${path}`, { method, headers: init.headers ?? {}, ...(init.body === undefined ? {} : { body: init.body }) }));
  const tool: DecisionRig["tool"] = async (args) =>
    answerOf(await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent" }, body: `{"name":"ae_decision_model","arguments":${args}}` }));
  return { filePath, events, logs, base, call, open, tool };
}

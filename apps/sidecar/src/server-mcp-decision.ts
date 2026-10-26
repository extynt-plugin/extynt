// The `ae_decision_model` tool: secret-free status, a one-time key-entry link, removal and a live test. The tool takes no key, so a key never passes through the agent.
import { decode, literal, object, optional } from "@extynt/decode";
import { jsonOf } from "@extynt/mcp-server";
import { providerDecoder } from "./decision-settings-apply.js";
import type { DecisionProvider } from "./decision-providers.js";
import type { DecisionSettings, DecisionTest } from "./decision-settings-service.js";
import { refuseCall, type McpCall, type McpToolsDeps } from "./server-mcp-model.js";
import type { DecisionState } from "./decision-settings-view.js";
import { openKeyLink } from "./server-decision-routes.js";

const toolArguments = object({ action: literal("status", "setup", "clear", "test"), provider: optional(providerDecoder) });

const SETUP_SAY = "Open this link to paste your key; it's stored only on this computer.";

type DecisionData =
  | { readonly state: DecisionState }
  | { readonly test: DecisionTest }
  | { readonly cleared: boolean; readonly state: DecisionState }
  | (ReturnType<typeof openKeyLink> & { readonly say: string; readonly note: string });

async function data(deps: McpToolsDeps, settings: DecisionSettings, action: "status" | "setup" | "clear" | "test", provider: DecisionProvider | null): Promise<DecisionData> {
  if (action === "setup") return { ...openKeyLink(deps.state, provider), say: SETUP_SAY, note: "The key is typed on that page, never into the chat." };
  if (action === "test") return { test: await settings.test(provider) };
  if (action === "clear") {
    const targets = provider === null ? settings.state().models.map((model) => model.provider) : [provider];
    const removed = targets.map((target) => settings.remove(target));
    return { cleared: removed.every((outcome) => outcome.ok), state: settings.state() };
  }
  return { state: settings.state() };
}

/** Answers the call to `ae_decision_model`. */
export async function answerDecisionModel(deps: McpToolsDeps, call: McpCall, snapshotFingerprint: string | null): Promise<void> {
  const settings = deps.state.options.decisionSettings;
  const parsed = decode(toolArguments, call.input.arguments);
  if (!parsed.ok) {
    refuseCall(deps.transport, call.exchange, { status: 422, code: "INVALID_ARGUMENTS", message: "ae_decision_model needs action: status, setup, clear or test; provider is optional." });
    return;
  }
  if (!settings) {
    refuseCall(deps.transport, call.exchange, { status: 404, code: "SETTINGS_UNAVAILABLE", message: "This sidecar was started without a settings file." });
    return;
  }
  const result = await data(deps, settings, parsed.value.action, parsed.value.provider ?? null);
  call.answer({ ok: true, tool: call.input.name, snapshotFingerprint, data: jsonOf(result) });
}

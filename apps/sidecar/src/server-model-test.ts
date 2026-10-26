// The model connectivity check: one tiny request without tools, so a wrong key, address or model shows up before the first real chat.
import { decodeOrThrow, fallback, type Infer, string } from "@extynt/decode";
import type { ChatProvider } from "@extynt/llm";

import { canRunAgent, runAgent, type AgentRunInput, type AgentRunResult } from "./agent.js";
import type { ModelSlot } from "./llm-config.js";
import { lenientObject } from "./server-mcp-arguments.js";
import { providerNameOf, providerOf, slotNamed } from "./server-model-slots.js";
import { answer, type JsonAnswer } from "./server-route-table.js";
import { translatorOf } from "./ui-language.js";
import type { SidecarState } from "./server-state.js";

const REPLY_PREVIEW_CHARS = 80;
const CHECK_INSTRUCTION = "Reply with the single word OK.";

/** The body of a check request: which slot to check, the primary slot when it says nothing. */
export const modelTestBody = lenientObject({ slot: fallback(string(), undefined) });

/** A check request with no choice made. */
export const DEFAULT_MODEL_TEST: Infer<typeof modelTestBody> = decodeOrThrow(modelTestBody, {});

type TestState = Pick<SidecarState, "chatProvider" | "fallbackChatProvider" | "hostFacts" | "modelKeyVariables" | "now" | "options">;
type RunFailure = NonNullable<AgentRunResult["failure"]>;

type ModelTestReport =
  | { readonly ok: true; readonly slot: ModelSlot; readonly provider: string; readonly model: string; readonly reply: string; readonly ms: number }
  | { readonly ok: false; readonly slot: ModelSlot; readonly error: RunFailure | { readonly code: string; readonly message: string }; readonly ms?: number };

function reportAnswer(report: ModelTestReport, outcome: "succeeded" | "rejected" | "failed", errorCode?: string): JsonAnswer<ModelTestReport> {
  return { ...answer(200, report, outcome), ...(errorCode === undefined ? {} : { errorCode }) };
}

function unavailable(slot: ModelSlot, code: string, message: string): JsonAnswer<ModelTestReport> {
  return reportAnswer({ ok: false, slot, error: { code, message } }, "rejected", code);
}

function connectivityCheck(state: TestState, slot: ModelSlot, provider: ChatProvider, startedAt: number): AgentRunInput {
  return {
    requestId: `model-test-${startedAt}`,
    message: CHECK_INSTRUCTION,
    history: [],
    briefing: `You are a connectivity check. ${CHECK_INSTRUCTION}`,
    callTool: () => ({ ok: false, error: { code: "TOOL_NOT_AVAILABLE", message: "No tools in a connectivity check." } }),
    maxSteps: 1,
    providerName: providerNameOf(state, slot, provider),
    translate: translatorOf(state),
  };
}

function checked(run: AgentRunResult, provider: ChatProvider, slot: ModelSlot, ms: number): JsonAnswer<ModelTestReport> {
  if (run.failure && run.failure.code !== "STEP_LIMIT") return reportAnswer({ ok: false, slot, error: run.failure, ms }, "failed", run.failure.code);
  return reportAnswer({ ok: true, slot, provider: provider.displayMetadata.displayName, model: provider.model, reply: run.answer.slice(0, REPLY_PREVIEW_CHARS), ms }, "succeeded");
}

/** Runs the connectivity check against the slot's model. Every outcome is a 200: the report says whether the model answered. */
export async function modelTestReply(state: TestState, body: Infer<typeof modelTestBody>): Promise<JsonAnswer<ModelTestReport>> {
  const slot = slotNamed(body.slot);
  const provider = providerOf(state, slot);
  const t = translatorOf(state);
  if (!provider) return unavailable(slot, "LLM_NOT_CONFIGURED", t(slot === "fallback" ? "failure.model.noFallback" : "failure.model.noModel"));
  if (!canRunAgent(provider)) return unavailable(slot, "NO_TOOL_CALLING", t("failure.model.noToolCalling", { name: provider.displayMetadata.displayName }));
  const startedAt = Date.now();
  const run = await runAgent(provider, connectivityCheck(state, slot, provider, startedAt));
  return checked(run, provider, slot, Date.now() - startedAt);
}

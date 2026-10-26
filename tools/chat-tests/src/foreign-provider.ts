/**
 * A chat provider that was built inside the sidecar's own modules, held at arm's length: every member is read through
 * `Foreign` and every answer is decoded into the shape `@extynt/llm` declares, so the harness never trusts a type it did not check.
 */
import { CapabilityLedger, REASONING_EFFORTS } from "@extynt/llm";
import type {
  AgentStepInput, AgentStepResult, ChatProvider, ProviderCompletion, ProviderConfig, ProviderDisplayMetadata, ProviderInput, ReasoningEffort,
  ToolCallingProvider,
} from "@extynt/llm";
import {
  absentAs, array, boolean, instanceOf, jsonObject, jsonValue, literal, map, nullValue, number, object, optional, string, type Foreign,
} from "@extynt/decode";

const effort = literal(...REASONING_EFFORTS);
const authSource = literal("server-environment", "local-secret-input");
const usage = object({
  inputTokens: optional(number()), outputTokens: optional(number()), totalTokens: optional(number()), cachedInputTokens: optional(number()),
});
const configDecoder = object({
  id: string(), endpoint: string(), model: string(), authSource, displayName: optional(string()), contextWindow: optional(number()),
  reasoningEffort: optional(effort), stream: optional(boolean()), acceptsImages: optional(boolean()),
});
const displayDecoder = object({
  id: string(), displayName: string(), endpoint: string(), model: string(), authSource, keyConfigured: boolean(),
  contextWindow: optional(number()), reasoningEffort: optional(effort), acceptsImages: optional(boolean()),
});
const completionDecoder = object({ answer: string(), providerRequestId: optional(string()), usage: optional(usage) });
const toolCall = object({ id: string(), name: string(), arguments: jsonObject, argumentsError: optional(string()) });
const stepDecoder = object({
  text: string(), toolCalls: map(array(toolCall), (calls) => [...calls]), raw: optional(jsonValue), finishReason: optional(string()), usage: optional(usage),
});
const nothing = absentAs(nullValue, undefined);
const ledgerDecoder = absentAs(instanceOf(CapabilityLedger, "a capability ledger"), undefined);

class ForeignChatProvider implements ChatProvider {
  protected readonly handle: Foreign;
  readonly capabilities?: CapabilityLedger;
  discoverCapabilities?: () => Promise<void>;
  discoverEfforts?: (options?: { refresh?: boolean }) => Promise<ReasoningEffort[]>;

  constructor(handle: Foreign) {
    this.handle = handle;
    const ledger = handle.read("capabilities").into(ledgerDecoder);
    if (ledger) this.capabilities = ledger;
    if (handle.hasFunction("discoverCapabilities")) {
      this.discoverCapabilities = () => handle.invoke("discoverCapabilities", []).intoAwaited(nothing).then(() => undefined);
    }
    if (handle.hasFunction("discoverEfforts")) {
      this.discoverEfforts = (options) => handle.invoke("discoverEfforts", [options]).intoAwaited(array(effort)).then((levels) => [...levels]);
    }
  }

  get id(): string { return this.handle.read("id").into(string()); }
  get model(): string { return this.handle.read("model").into(string()); }
  get config(): ProviderConfig { return this.handle.read("config").into(configDecoder); }
  get displayMetadata(): ProviderDisplayMetadata { return this.handle.read("displayMetadata").into(displayDecoder); }
  complete(input: ProviderInput): Promise<ProviderCompletion> { return this.handle.invoke("complete", [input]).intoAwaited(completionDecoder); }
}

class ForeignToolProvider extends ForeignChatProvider implements ToolCallingProvider {
  step(input: AgentStepInput): Promise<AgentStepResult> { return this.handle.invoke("step", [input]).intoAwaited(stepDecoder); }
}

/** The sidecar's provider as a typed provider: settings are read when asked, answers are decoded, and `step` exists exactly when the provider has one. */
export function foreignProvider(handle: Foreign): ChatProvider {
  return handle.hasFunction("step") ? new ForeignToolProvider(handle) : new ForeignChatProvider(handle);
}

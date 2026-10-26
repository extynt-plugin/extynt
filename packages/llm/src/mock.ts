/** A deterministic, no-network provider for contract tests and local development. */
import { providerDisplayMetadata, type ProviderConfig, type ProviderDisplayMetadata } from "./provider-config.js";
import type { AgentStepInput, AgentStepResult, ProviderCompletion, ProviderInput, ToolCallingProvider } from "./types.js";

/** `acceptsImages` is the user's declared answer to "does it take images", as a real slot would carry it; `script` answers agent turns, and without one `step()` answers with plain text. */
export interface MockProviderOptions {
  answer?: string;
  model?: string;
  acceptsImages?: boolean;
  script?: (input: AgentStepInput) => AgentStepResult | Promise<AgentStepResult>;
}

/** Answers every call with a fixed text and records the inputs it received. */
export class MockProvider implements ToolCallingProvider {
  public readonly id = "mock";
  public readonly model: string;
  public readonly config: ProviderConfig;
  public readonly displayMetadata: ProviderDisplayMetadata;
  public calls = 0;
  public lastInput: ProviderInput | undefined;
  public stepInputs: AgentStepInput[] = [];
  private readonly answer: string;
  private readonly script: MockProviderOptions["script"];

  public constructor(options: MockProviderOptions = {}) {
    this.answer = options.answer ?? "Mock provider: the project context was received.";
    this.model = options.model ?? "mock-v1";
    this.script = options.script;
    this.config = { id: this.id, endpoint: "https://mock.invalid", model: this.model, authSource: "server-environment", displayName: "Mock provider", ...(options.acceptsImages !== undefined ? { acceptsImages: options.acceptsImages } : {}) };
    this.displayMetadata = providerDisplayMetadata(this.config, false);
  }

  public async complete(input: ProviderInput): Promise<ProviderCompletion> {
    this.calls += 1;
    this.lastInput = input;
    return { answer: this.answer, providerRequestId: `mock-${this.calls}` };
  }

  public async step(input: AgentStepInput): Promise<AgentStepResult> {
    this.calls += 1;
    this.stepInputs.push(input);
    return this.script ? this.script(input) : { text: this.answer, toolCalls: [] };
  }
}

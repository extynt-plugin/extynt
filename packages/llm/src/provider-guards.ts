/** Type guards that tell which optional capabilities a provider has. */
import type { ChatProvider, StructuredOutputProvider, ToolCallingProvider } from "./types.js";

export function supportsTools(provider: ChatProvider | undefined): provider is ToolCallingProvider {
  return provider !== undefined && "step" in provider && typeof provider.step === "function";
}

export function supportsStructuredOutput(provider: ChatProvider | undefined): provider is StructuredOutputProvider {
  return provider !== undefined && "completeJson" in provider && typeof provider.completeJson === "function";
}

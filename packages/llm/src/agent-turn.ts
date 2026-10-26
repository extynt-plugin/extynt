/** Reads of an agent step's input that every adapter makes the same way: the stable history apart from the per-step trailing messages, and the pictures a step carries. */
import type { AgentMessage, AgentStepInput, ProviderImage } from "./types.js";

/** The stable history and the per-step trailing messages, so an adapter can cache and attach images to the former only. */
export function splitTransient(messages: AgentMessage[]): { persisted: AgentMessage[]; transient: AgentMessage[] } {
  const isTransient = (message: AgentMessage): boolean => message.role === "user" && message.transient === true;
  return { persisted: messages.filter((message) => !isTransient(message)), transient: messages.filter(isTransient) };
}

/** Every picture a step carries, in order. */
export function stepImages(input: Pick<AgentStepInput, "image" | "images">): ProviderImage[] {
  return [...(input.image ? [input.image] : []), ...(input.images ?? [])];
}

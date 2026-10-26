// Which of the two model slots a request names, and the provider and key variable that belong to it.
import { type JsonValue } from "@extynt/decode";
import type { ChatProvider } from "@extynt/llm";
import type { Translate } from "@extynt/ui-text";

import type { ModelSlot } from "./llm-config.js";
import type { SidecarState } from "./server-state.js";

type SlotState = Pick<SidecarState, "chatProvider" | "fallbackChatProvider" | "modelKeyVariables">;

/** The fallback slot when a request says so, the primary slot otherwise. */
export function slotNamed(name: JsonValue | undefined): ModelSlot {
  return name === "fallback" ? "fallback" : "primary";
}

/** The provider built for the slot, if the slot is set. */
export function providerOf(state: SlotState, slot: ModelSlot): ChatProvider | undefined {
  return slot === "fallback" ? state.fallbackChatProvider : state.chatProvider;
}

/** How a failure names the slot's provider: its display name and the variable that holds its key, when there is one. */
export function providerNameOf(state: SlotState, slot: ModelSlot, provider: ChatProvider): { displayName: string; keyVariable?: string } {
  const keyVariable = state.modelKeyVariables[slot];
  return { displayName: provider.displayMetadata.displayName, ...(keyVariable === undefined ? {} : { keyVariable }) };
}

/** The word that names the slot in the user's language, as a failure says "the primary slot". */
export function slotWord(t: Translate, slot: ModelSlot): string {
  return t(slot === "fallback" ? "failure.settings.slotFallback" : "failure.settings.slotPrimary");
}

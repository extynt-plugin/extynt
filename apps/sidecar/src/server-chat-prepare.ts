// Checks a decoded chat request against what a turn needs before it is admitted: valid reference images, a project to talk about or a tool-capable provider, and a usable attached frame.
import type { IncomingMessage } from "node:http";

import type { ProviderImage } from "@extynt/llm";

import { canRunAgent } from "./agent.js";
import type { ChatInput } from "./server-chat-request.js";
import { refuse, type RefusalAnswer } from "./server-route-table.js";
import type { SidecarState } from "./server-state.js";
import { delay } from "./server-http-wire.js";
import { normalizeChatImage } from "./server-chat-image.js";
import { normalizeReferenceImages } from "./workflow-references.js";

const SNAPSHOT_POLL_MS = 200;

/** A request that passed its checks. `discoveryOnly` is set when there is no project snapshot, so the turn may only use bounded discovery tools. */
export interface PreparedChat {
  readonly discoveryOnly: boolean;
  readonly input: ChatInput;
  readonly image?: { readonly mediaType: string; readonly base64: string };
  readonly images?: ProviderImage[];
}

type Preparation = { readonly kind: "prepared"; readonly chat: PreparedChat } | RefusalAnswer;

type PrepareState = Pick<SidecarState, "activePanelInstanceId" | "chatProvider" | "fallbackChatProvider" | "latest" | "panelSnapshotWaitMs">;

async function awaitPanelSnapshot(state: PrepareState, request: IncomingMessage): Promise<void> {
  if (state.latest || !state.activePanelInstanceId) return;
  const deadline = Date.now() + state.panelSnapshotWaitMs;
  while (!state.latest && Date.now() < deadline && !request.socket.destroyed) await delay(SNAPSHOT_POLL_MS);
}

function cannotAnswerWithoutSnapshot(state: PrepareState): boolean {
  return !state.latest && !canRunAgent(state.chatProvider) && !canRunAgent(state.fallbackChatProvider);
}

function isAttached(frame: ChatInput["image"]): boolean {
  return frame !== undefined && frame !== null;
}

/**
 * Checks reference images, then waits briefly for the fresh snapshot a paired panel publishes after pairing and after
 * every project change, so a turn that arrives in that window answers with project facts instead of from discovery
 * alone, then checks that something can answer and that an attached frame is a PNG or JPEG the panel could have produced.
 */
export async function prepareChat(state: PrepareState, request: IncomingMessage, input: ChatInput): Promise<Preparation> {
  const references = normalizeReferenceImages(input.images);
  if (!references.ok) return refuse(422, "INVALID_REFERENCE_IMAGES", references.message);
  await awaitPanelSnapshot(state, request);
  if (cannotAnswerWithoutSnapshot(state)) return refuse(409, "NO_SNAPSHOT", "This provider cannot use bounded discovery tools. Connect a tool-capable provider or collect bounded target metadata before chatting.");
  const image = normalizeChatImage(input.image);
  if (isAttached(input.image) && !image) return refuse(422, "INVALID_CHAT_IMAGE", "An attached frame must be a PNG the panel's capture could have produced.");
  const images = references.images.length > 0 ? { images: references.images } : {};
  return { kind: "prepared", chat: { input, discoveryOnly: !state.latest, ...(image ? { image } : {}), ...images } };
}

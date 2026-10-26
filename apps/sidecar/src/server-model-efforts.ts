// The reasoning-effort levels a model offers and the level a request would actually send, as the panel's model settings show them.
import { effortWithin, imagesAccepted, type ChatProvider } from "@extynt/llm";

import { providerFailure } from "./agent-failure.js";
import { failed } from "./server-failed-reply.js";
import { translatorOf } from "./ui-language.js";
import { providerNameOf, providerOf, slotNamed, slotWord } from "./server-model-slots.js";
import { ok, refuse, type JsonAnswer, type RefusalAnswer } from "./server-route-table.js";
import type { SidecarState } from "./server-state.js";

type EffortState = Pick<SidecarState, "chatProvider" | "fallbackChatProvider" | "hostFacts" | "modelKeyVariables" | "now" | "options">;

/** What the panel shows about the active model: the model's own report or the user's own setting. */
export interface ReportedCapabilities {
  readonly acceptsImages: boolean;
  readonly imagesReportedBy: "setting" | "model" | "unreported";
  readonly efforts: readonly string[] | null;
  readonly effectiveEffort: string | null;
}

function effectiveEffort(provider: ChatProvider): string | null {
  const stored = provider.config.reasoningEffort;
  return stored === undefined ? null : effortWithin(provider.capabilities?.current.efforts, stored) ?? null;
}

function imagesReporter(declared: boolean | undefined, reported: boolean | undefined): ReportedCapabilities["imagesReportedBy"] {
  if (declared !== undefined) return "setting";
  return reported !== undefined ? "model" : "unreported";
}

/** The capabilities of the provider: `efforts` is null until the model has named its levels, `effectiveEffort` is the level a request sends for the stored choice (null when none is chosen or the model takes no effort control), and images are offered unless one of them said no. */
export function reportedCapabilities(provider: ChatProvider): ReportedCapabilities {
  const declared = provider.config.acceptsImages;
  const reported = provider.capabilities?.current;
  return {
    acceptsImages: imagesAccepted(declared, reported?.images),
    imagesReportedBy: imagesReporter(declared, reported?.images),
    efforts: reported?.efforts ?? null,
    effectiveEffort: effectiveEffort(provider),
  };
}

async function discoveredEfforts(provider: ChatProvider, refresh: boolean): Promise<readonly string[] | undefined> {
  if (provider.discoverEfforts) return await provider.discoverEfforts({ refresh });
  await provider.discoverCapabilities?.();
  return provider.capabilities?.current.efforts;
}

interface EffortLevels {
  readonly ok: true;
  readonly slot: string;
  readonly model: string;
  readonly efforts: readonly string[];
  readonly effectiveEffort: string | null;
}

type FailureEnvelope = ReturnType<typeof failed>["body"];

/** The effort levels of the slot's model. `refresh` asks the provider for its list again instead of answering from the first answer. */
export async function modelEffortsReply(state: EffortState, query: URLSearchParams): Promise<JsonAnswer<EffortLevels | FailureEnvelope> | RefusalAnswer> {
  const slot = slotNamed(query.get("slot"));
  const provider = providerOf(state, slot);
  const t = translatorOf(state);
  if (!provider) return refuse(422, "LLM_NOT_CONFIGURED", t("failure.model.slotNotSet", { slot: slotWord(t, slot) }));
  try {
    const efforts = await discoveredEfforts(provider, query.get("refresh") === "1");
    if (!efforts) return failed(501, "EFFORT_LEVELS_UNREPORTED", t("failure.model.noEffortLevels", { name: provider.displayMetadata.displayName }));
    return ok({ ok: true, slot, model: provider.model, efforts, effectiveEffort: effectiveEffort(provider) });
  } catch (error) {
    const failure = providerFailure(error, providerNameOf(state, slot, provider), t);
    return failed(502, failure.code, failure.message);
  }
}

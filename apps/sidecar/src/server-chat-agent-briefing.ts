// The turn's briefing and the live state appended to each step: a discovery turn gets the index and host notes, a project turn the full agent briefing.
import type { ChatProvider } from "@extynt/llm";
import { briefingNotes, buildAgentBriefing, buildAgentBriefingSegments, turnBudget } from "./agent.js";
import { ASSERTS_CURRENT_STATE } from "@extynt/decide";
import { bookedYesNo } from "./decision-book.js";
import { carriedContextSummary } from "./context-carry.js";
import { enterChatSession, foreignJobs } from "./chat-session-fence.js";
import { discoveryBriefing } from "./discovery-briefing.js";
import { discoveryIndexPrefetch } from "./discovery-prefetch.js";
import { resolveRequestTerms, resolvedLines } from "./decision-resolve.js";
import { usageBriefingLine } from "./effect-notes-briefing.js";
import { briefedWithFocus, segmentsWithFocus } from "./live-focus.js";
import { requestedOperationTypes } from "./request-coverage.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { heldAnimationState } from "./server-workflow-design-release.js";
import { specialistRuntimeState } from "./server-workflow-specialists.js";

type LatestSnapshot = NonNullable<ReturnType<ChatAgentDeps["planState"]["normalizedLatest"]>>;

/** The turn's briefing as text and as cache segments. */
export interface TurnBriefing {
  readonly text: string;
  readonly segments: ReturnType<typeof segmentsWithFocus>;
}

interface BriefingTurn {
  readonly deps: ChatAgentDeps;
  readonly provider: ChatProvider;
  readonly input: ChatAgentInput;
  readonly focusNote: string | undefined;
  readonly normalized: LatestSnapshot | undefined;
  readonly discovery: boolean;
}

function claimBooking(goal: string): { readonly claimBooked?: boolean } {
  const booked = bookedYesNo({ decision: ASSERTS_CURRENT_STATE.name, text: goal });
  return booked === undefined ? {} : { claimBooked: booked };
}

function requestGoalOf(input: Pick<ChatAgentInput, "workflowGoalSummary" | "message">): string {
  return input.workflowGoalSummary ?? input.message;
}

async function discoveryTurnBriefing({ deps, provider, input, focusNote }: BriefingTurn): Promise<TurnBriefing> {
  const prefetch = await discoveryIndexPrefetch(deps, input);
  const hostNotes = briefingNotes(deps.state.hostLink.status().host, "");
  const text = briefedWithFocus([discoveryBriefing(provider.displayMetadata.displayName), hostNotes, prefetch].filter(Boolean).join("\n\n"), focusNote);
  return { text, segments: [{ text }] };
}

function projectTurnBriefing({ deps, provider, input, focusNote }: BriefingTurn, normalized: LatestSnapshot): TurnBriefing {
  const options = {
    plans: deps.state.plans,
    providerName: provider.displayMetadata.displayName,
    autoApply: input.autoApply,
    briefingTokens: turnBudget(provider.config?.contextWindow, provider.config?.reasoningEffort).briefingTokens,
    runtimeEvidence: deps.planState.currentRuntimeEvidence(),
    latestInterruptedApply: deps.state.latestInterruptedApply,
    usageLine: briefingNotes(deps.state.hostLink.status().host, usageBriefingLine(deps.state.collection.effectNotes)),
    relevantOperationTypes: requestedOperationTypes(requestGoalOf(input)),
    requestGoal: requestGoalOf(input),
    ...claimBooking(requestGoalOf(input)),
  };
  return { text: briefedWithFocus(buildAgentBriefing(normalized, options), focusNote), segments: segmentsWithFocus(buildAgentBriefingSegments(normalized, options), focusNote) };
}

/** A discovery turn has no usage line but still hears what is unusual about this After Effects (experimental, unmeasured, unsupported); a project turn is briefed to the same budget the loop runs on. */
export async function turnBriefing(turn: BriefingTurn): Promise<TurnBriefing> {
  return turn.discovery || !turn.normalized ? await discoveryTurnBriefing(turn) : await withResolvedTerms(turn, projectTurnBriefing(turn, turn.normalized));
}

async function withResolvedTerms({ deps, input }: BriefingTurn, base: TurnBriefing): Promise<TurnBriefing> {
  if ((input.workflowCycle ?? 0) > 0) return base;
  const terms = await resolveRequestTerms(deps.state.decisions, requestGoalOf(input), { profile: deps.state.hostProfile, snapshot: deps.planState.normalizedLatest(), preferences: deps.state.preferences, aliases: deps.state.aliases });
  const lines = resolvedLines(terms).join("\n");
  return lines === "" ? base : { text: `${base.text}\n\n${lines}`, segments: [...base.segments, { text: lines }] };
}

function observedTargets(snapshot: LatestSnapshot | undefined): Array<{ id: string; name: string; observedLayerIds: string[] }> | null {
  return snapshot?.compositions.map((composition) => ({ id: composition.id, name: composition.name, observedLayerIds: composition.layers.map((layer) => layer.id) })) ?? null;
}

function snapshotFacts(snapshot: LatestSnapshot | undefined) {
  return { snapshotAvailable: !!snapshot, fingerprint: snapshot?.fingerprint ?? null, coverage: snapshot?.coverage ?? null, hostStamp: snapshot?.hostStamp ?? null, observedTargets: observedTargets(snapshot) };
}

function discoveryLiveState(deps: ChatAgentDeps): string {
  const snapshot = deps.planState.normalizedLatest();
  const nextWorkflow = snapshot ? "A subsequent ordinary chat turn can enter the existing approval-bound workflow from this observation." : "Demand the intended target's bounded layer metadata; no project identity is assumed.";
  return `Sidecar discovery state (infrastructure evidence; this turn remains read-only):\n${JSON.stringify({ mode: "read-only-discovery", ...snapshotFacts(snapshot), nextWorkflow })}`;
}

function carriedLiveState(deps: ChatAgentDeps): string | undefined {
  const store = deps.state.workflowCoordinator.workflowStore;
  return carriedContextSummary({ state: store.getState(), snapshot: deps.planState.normalizedLatest(), hiddenJobs: foreignJobs(store) });
}

function liveStateParts(deps: ChatAgentDeps, input: ChatAgentInput): Array<string | undefined> {
  const turnState = deps.chatSupport.runningTurnState(input.requestId);
  if (input.discoveryOnly) return [turnState, discoveryLiveState(deps)];
  return [turnState, carriedLiveState(deps), specialistRuntimeState(deps, input), heldAnimationState(deps, input)];
}

/** What the model sees appended to every step, rebuilt each time from the store and the latest read, so a continuation or a follow-up turn does not rediscover the project. */
export function liveStateOf(deps: ChatAgentDeps, input: ChatAgentInput): () => string {
  const store = deps.state.workflowCoordinator.workflowStore;
  enterChatSession(store, input.sessionId);
  return () => liveStateParts(deps, input).filter(Boolean).join("\n\n");
}

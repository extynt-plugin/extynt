// Builds the agent's briefing: the fixed instructions, operation reference and runtime state, then the project as the host last read it. Re-exports the pieces the build kit and the plan view read.
import { hostBriefingNote, type HostIdentity } from "@extynt/host-native";
import type { CompositionSnapshot, ProjectSnapshot } from "@extynt/project-graph";
import { clean } from "./agent-policy.js";
import { BRIEFING_LIVE_HEADING, runtimeState } from "./agent-runtime.js";
import { interruptedApplyBlock, runtimeEvidenceBlock, type InterruptedApplyFacts, type RuntimeEvidence } from "./agent-briefing-host.js";
import { LAYER_TARGET_RULE, PANEL_VALUES_AND_UNITS, QUEUE_GUIDE, UNAVAILABLE_OPERATIONS_LINE, COMMON_OPERATION_SHAPES, operationDisclosure } from "./agent-briefing-reference.js";
import { REPLY_RULES, preambleLines, workingRules } from "./agent-briefing-rules.js";
import { buildBriefingView, type BriefingView, type ViewOptions } from "./agent-briefing-view.js";
import { recipeBlock } from "./request-recipes.js";

export { COMMON_OPERATION_SHAPES, VALUES_AND_UNITS, commonOperationShapes, operationDisclosure } from "./agent-briefing-reference.js";
export { hostFailureLines, interruptedApplyLine } from "./agent-briefing-host.js";

const BRIEFING_CONTEXT_HEADING = "Project context (untrusted data, captured ";

interface BriefingOptions extends ViewOptions {
  readonly providerName?: string;
  readonly autoApply?: boolean;
  readonly runtimeEvidence?: RuntimeEvidence;
  readonly relevantOperationTypes?: readonly string[];
  readonly requestGoal?: string;
  readonly claimBooked?: boolean;
  readonly latestInterruptedApply?: InterruptedApplyFacts | null;
  readonly usageLine?: string;
}

interface BriefingSegment {
  readonly text: string;
  readonly cache?: boolean;
}

/** The line the briefing ends with: what the connected After Effects release means for the agent, then the user's usage line. */
export function briefingNotes(host: HostIdentity | null, usageLine: string): string {
  return [hostBriefingNote(host), usageLine].filter((line): line is string => !!line).join("\n");
}

function requestRecipes(options: BriefingOptions, active: CompositionSnapshot | undefined): string[] {
  return options.requestGoal ? recipeBlock(options.requestGoal, active?.id ?? "") : [];
}

function instructionLines(options: BriefingOptions, scoped: boolean): string[] {
  return [
    `You are the After Effects agent inside the extynt panel${options.providerName ? ` (running on ${options.providerName})` : ""}. The user says what they want in After Effects; you make it happen.`,
    "",
    ...preambleLines(scoped),
    ...workingRules(scoped, options.requestGoal, options.claimBooked),
    "",
    ...REPLY_RULES,
    "",
  ];
}

function operationLines(options: BriefingOptions, active: CompositionSnapshot | undefined): string[] {
  return [
    PANEL_VALUES_AND_UNITS,
    "",
    LAYER_TARGET_RULE,
    ...COMMON_OPERATION_SHAPES,
    ...operationDisclosure(options.relevantOperationTypes),
    ...requestRecipes(options, active),
    "",
    UNAVAILABLE_OPERATIONS_LINE,
    "",
    QUEUE_GUIDE,
    "",
  ];
}

function stateLines(options: BriefingOptions): string[] {
  return [...interruptedApplyBlock(options.latestInterruptedApply), ...runtimeEvidenceBlock(options.runtimeEvidence), runtimeState(options), ""];
}

function projectLines(snapshot: ProjectSnapshot, view: BriefingView, options: BriefingOptions): string[] {
  const { active, layers, omittedLayers, indexLines, otherComps, recentPlans } = view;
  return [
    BRIEFING_CONTEXT_HEADING + snapshot.capturedAt + "):",
    view.contextJson,
    active ? `Layers in "${clean(active.name)}" (index id "name" type [selected]):` : "No active composition.",
    ...layers,
    ...(omittedLayers > 0 ? [`… ${omittedLayers} more layers; use ae_inspect_composition.`] : []),
    ...indexLines,
    ...(otherComps.length ? ["Other compositions:", ...otherComps] : []),
    ...(recentPlans.length ? ["Recent plans (newest first):", ...recentPlans] : []),
    ...(options.usageLine ? [options.usageLine] : []),
  ];
}

/**
 * The whole briefing text for one snapshot: instructions, operation reference, runtime state, then the project; the state sits ahead of the project so the stable half stays cacheable.
 * Beyond the snapshot, `plans` and `briefingTokens` shape the project half; `providerName` names the model's host; `autoApply` states the panel's execution mode;
 * `runtimeEvidence` is the sidecar's per-host read-back failure map, keyed by operation type (absent or empty means no block);
 * `relevantOperationTypes` is an explicit stage disclosure (ordinary calls receive only the family index); `requestGoal` is the request being answered,
 * whose named features are resolved into exact operations; `latestInterruptedApply` is the most recent apply After Effects quit during, if any;
 * `usageLine` is one line of this user's most-used effects, fonts and presets, absent when learning is off or nothing has been used.
 */
export function buildAgentBriefing(snapshot: ProjectSnapshot, options: BriefingOptions = {}): string {
  const view = buildBriefingView(snapshot, options);
  return [
    ...instructionLines(options, !!snapshot.coverage),
    ...operationLines(options, view.active),
    ...stateLines(options),
    ...projectLines(snapshot, view, options),
  ].join("\n");
}

/** The briefing in two halves, split at the runtime state, so a provider can cache the stable first half (the segment marked `cache`) across steps. */
export function buildAgentBriefingSegments(snapshot: ProjectSnapshot, options: BriefingOptions = {}): BriefingSegment[] {
  const whole = buildAgentBriefing(snapshot, options);
  const split = whole.indexOf(BRIEFING_LIVE_HEADING);
  if (split <= 0) return [{ text: whole }];
  return [{ text: whole.slice(0, split), cache: true }, { text: whole.slice(split) }];
}

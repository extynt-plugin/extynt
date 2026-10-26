// Reads a project snapshot into the parts of the agent briefing that depend on the project: the layer list, the project index, the other compositions, the recent plans and the context JSON.
import type { StoredPlan } from "@extynt/mcp-server";
import { getActiveComposition, type CompositionSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { MAX_OTHER_COMPS, MAX_PROBE_WARNINGS, MAX_PROBE_WARNING_CHARS, MAX_RECENT_PLANS, MAX_SELECTED_LAYER_IDS, clean, estimateTokens, round, turnBudget } from "./agent-policy.js";
import { layerKind, layerLine, summarizeLayers, type KindLookup, type LayerIndex } from "./agent-briefing-index.js";

/** What a view needs from the caller: the plans to list and the token budget for the layer list. */
export interface ViewOptions {
  readonly plans?: ReadonlyMap<string, StoredPlan>;
  readonly briefingTokens?: number;
}

/** The project-dependent lines of a briefing, ready to place between the fixed halves. */
export interface BriefingView {
  readonly active: CompositionSnapshot | undefined;
  readonly layers: readonly string[];
  readonly omittedLayers: number;
  readonly indexLines: readonly string[];
  readonly otherComps: readonly string[];
  readonly recentPlans: readonly string[];
  readonly contextJson: string;
}

interface ProbeFacts {
  readonly warnings: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  readonly truncated: boolean;
}

interface LayerList {
  readonly layers: readonly string[];
  readonly omittedLayers: number;
}

interface IndexInput {
  readonly scoped: boolean;
  readonly active: CompositionSnapshot | undefined;
  readonly index: LayerIndex;
  readonly list: LayerList;
  readonly omittedComps: number;
  readonly probe: ProbeFacts;
  readonly layerLimitWarning: string | undefined;
}

interface ObservedComposition {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly frameRate: number;
}

interface ActiveCompositionFacts {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationSeconds: number;
  readonly currentTime: number | null;
  readonly layerCount: number | null;
  readonly observedLayerCount?: number;
}

interface BriefingContext {
  readonly coverage?: ProjectSnapshot["coverage"];
  readonly observedTargetCompositions?: readonly ObservedComposition[];
  readonly hostStamp?: ProjectSnapshot["hostStamp"];
  readonly unobservedFields?: string;
  readonly host: string;
  readonly project: string;
  readonly activeComposition: ActiveCompositionFacts | null;
  readonly selectedLayerIds: readonly string[];
  readonly selectedLayerCount?: number;
  readonly selectedLayerIdsOmitted?: number;
  readonly projectViewTruncated?: true;
  readonly probeWarnings?: readonly string[];
  readonly probeWarningCount?: number;
  readonly probeWarningsOmitted?: number;
  readonly probeLimits?: Readonly<Record<string, number>>;
}

function probeOf(snapshot: ProjectSnapshot): ProbeFacts {
  return { warnings: snapshot.warnings ?? [], limits: snapshot.truncation?.limits ?? {}, truncated: !!snapshot.coverage || snapshot.truncation?.truncated === true };
}

function kindLookup(snapshot: ProjectSnapshot): KindLookup {
  return {
    sourceTypes: new Map((snapshot.sources ?? []).map((source) => [source.id, source.type] as const)),
    compositionIds: new Set(snapshot.compositions.map((comp) => comp.id)),
  };
}

function listLayers(active: CompositionSnapshot | undefined, selected: ReadonlySet<string>, lookup: KindLookup, budget: number): LayerList {
  const layers: string[] = [];
  let tokens = 0;
  for (const layer of active?.layers ?? []) {
    const line = layerLine(layer, selected.has(layer.id), layerKind(layer, lookup));
    tokens += estimateTokens(line) + 1;
    if (tokens > budget) break;
    layers.push(line);
  }
  return { layers, omittedLayers: (active?.layers.length ?? 0) - layers.length };
}

function pluralized(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function indexFacts({ list, active, index, scoped }: IndexInput): string[] {
  if (scoped) return [`${list.layers.length} observed layers listed`, "unobserved layer visibility, effect, keyframe and expression counts are unknown"];
  const kinds = [...index.byKind].filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`).join(", ");
  return [
    `${list.layers.length} of ${active?.layers.length ?? 0} probed layers listed, ${list.omittedLayers} omitted`,
    kinds,
    `${index.selected} selected, ${index.locked} locked, ${index.hidden} hidden`,
    `effects on ${index.effectedLayers} ${pluralized(index.effectedLayers, "layer", "layers")} (${index.effectInstances} in total)`,
    `keyframes on ${index.keyframed} ${pluralized(index.keyframed, "property", "properties")}, expressions on ${index.expressed} ${pluralized(index.expressed, "property", "properties")}`,
  ].filter(Boolean);
}

function limitText(limits: Readonly<Record<string, number>>): string {
  const entries = Object.entries(limits);
  return entries.length ? ` (limits: ${entries.map(([key, value]) => `${key}=${value}`).join(", ")})` : "";
}

function truncationReason({ probe, active, layerLimitWarning }: IndexInput): string | undefined {
  const limits = limitText(probe.limits);
  if (layerLimitWarning) return `The probe stopped at its ${round(probe.limits.maxLayersPerComposition ?? 0) || "configured"} layer limit for "${clean(active?.name ?? "")}"${limits}, so this project has more layers than are listed or reachable, and absence from this list is not proof a layer does not exist.`;
  return probe.truncated ? `The probe reported a truncated project view${limits}, so part of the project is not visible here, and absence from this list is not proof a layer does not exist.` : undefined;
}

function omissionReasons({ list, omittedComps }: IndexInput): string[] {
  const reasons: string[] = [];
  const omitted = list.omittedLayers;
  if (omitted > 0) reasons.push(`${omitted} ${pluralized(omitted, "layer is", "layers are")} omitted from this list to stay inside the prompt budget, and ae_inspect_composition still reaches ${pluralized(omitted, "it", "them")}.`);
  if (omittedComps > 0) reasons.push(`${omittedComps} more composition(s) were not listed; ae_find_project_objects searches only what the probe returned.`);
  return reasons;
}

function indexReasons(input: IndexInput): string[] {
  const truncation = truncationReason(input);
  return truncation ? [truncation, ...omissionReasons(input)] : omissionReasons(input);
}

function indexLines(input: IndexInput): string[] {
  const reasons = indexReasons(input);
  const partial = `View: partial. ${reasons.join(" ")}`;
  if (!input.active) return ["Project index: no active composition is open.", ...(reasons.length ? [partial] : [])];
  return [
    `Project index: ${indexFacts(input).join("; ")}.`,
    reasons.length ? partial : "View: complete. Every layer the probe returned for this composition is listed.",
    input.scoped ? "Scoped view: use ae_read_graph_page for demanded layer/property/value evidence; unobserved fields are unknown, including normalized defaults." : "Per-layer detail is not listed here: call ae_inspect_layer for a layer's transform, effects, keyframes, expressions, parent, lock and timing, or ae_inspect_composition for the whole composition.",
  ];
}

function activeFacts(snapshot: ProjectSnapshot, active: CompositionSnapshot | undefined): ActiveCompositionFacts | null {
  if (!active) return null;
  return {
    id: active.id,
    name: clean(active.name),
    width: active.width,
    height: active.height,
    frameRate: active.frameRate,
    durationSeconds: round(active.duration),
    currentTime: snapshot.currentTime === null ? null : round(snapshot.currentTime),
    layerCount: snapshot.coverage?.otherLayers === "unknown" ? null : active.layers.length,
    ...(snapshot.coverage ? { observedLayerCount: active.layers.length } : {}),
  };
}

function coverageFacts(snapshot: ProjectSnapshot): Pick<BriefingContext, "coverage" | "observedTargetCompositions" | "hostStamp" | "unobservedFields"> {
  if (!snapshot.coverage) return {};
  return {
    coverage: snapshot.coverage,
    observedTargetCompositions: snapshot.compositions.map((comp) => ({ id: comp.id, name: comp.name, width: comp.width, height: comp.height, duration: comp.duration, frameRate: comp.frameRate })),
    hostStamp: snapshot.hostStamp,
    unobservedFields: "unknown; graph normalization defaults are not observed facts",
  };
}

function probeContext(probe: ProbeFacts): Pick<BriefingContext, "projectViewTruncated" | "probeWarnings" | "probeWarningCount" | "probeWarningsOmitted" | "probeLimits"> {
  if (!probe.truncated) return {};
  const listed = probe.warnings.slice(0, MAX_PROBE_WARNINGS).map((warning) => clean(warning, MAX_PROBE_WARNING_CHARS));
  const cut = listed.length < probe.warnings.length ? { probeWarningCount: probe.warnings.length, probeWarningsOmitted: probe.warnings.length - listed.length } : {};
  return { projectViewTruncated: true, probeWarnings: listed, ...cut, probeLimits: probe.limits };
}

function briefingContext(snapshot: ProjectSnapshot, active: CompositionSnapshot | undefined, probe: ProbeFacts): BriefingContext {
  const selectedLayerIds = snapshot.selection.layerIds;
  const listedSelection = selectedLayerIds.slice(0, MAX_SELECTED_LAYER_IDS);
  const overflow = listedSelection.length < selectedLayerIds.length ? { selectedLayerCount: selectedLayerIds.length, selectedLayerIdsOmitted: selectedLayerIds.length - listedSelection.length } : {};
  return {
    ...coverageFacts(snapshot),
    host: `After Effects ${snapshot.host.version}`,
    project: clean(snapshot.project.name),
    activeComposition: activeFacts(snapshot, active),
    selectedLayerIds: listedSelection,
    ...overflow,
    ...probeContext(probe),
  };
}

function otherCompLines(snapshot: ProjectSnapshot, active: CompositionSnapshot | undefined): string[] {
  return snapshot.compositions
    .filter((comp) => comp.id !== active?.id)
    .slice(0, MAX_OTHER_COMPS)
    .map((comp) => `${comp.id} "${clean(comp.name)}" ${comp.width}x${comp.height} ${round(comp.duration)}s ${comp.layers.length} layers`);
}

function recentPlanLines(plans: ReadonlyMap<string, StoredPlan> | undefined): string[] {
  return [...(plans?.values() ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_RECENT_PLANS)
    .map((record) => `${record.plan.planId}: "${clean(record.presentation?.title ?? "")}" ${record.status}`);
}

/** Reads the snapshot into the lines and context JSON the briefing places around its fixed text; a scoped (graph-page) snapshot lists only the layers it observed. */
export function buildBriefingView(snapshot: ProjectSnapshot, options: ViewOptions): BriefingView {
  const active = getActiveComposition(snapshot);
  const selected = new Set(snapshot.selection.layerIds);
  const lookup = kindLookup(snapshot);
  const list = listLayers(active, selected, lookup, options.briefingTokens ?? turnBudget(undefined, undefined).briefingTokens);
  const probe = probeOf(snapshot);
  const input: IndexInput = {
    scoped: !!snapshot.coverage,
    active,
    index: summarizeLayers(active?.layers ?? [], selected, lookup),
    list,
    omittedComps: snapshot.compositions.length - 1 - Math.min(Math.max(snapshot.compositions.length - 1, 0), MAX_OTHER_COMPS),
    probe,
    layerLimitWarning: active ? probe.warnings.find((warning) => warning === `layer-count-limit:${active.name}`) : undefined,
  };
  return {
    active,
    layers: list.layers,
    omittedLayers: list.omittedLayers,
    indexLines: indexLines(input),
    otherComps: otherCompLines(snapshot, active),
    recentPlans: recentPlanLines(options.plans),
    contextJson: JSON.stringify(briefingContext(snapshot, active, probe)),
  };
}

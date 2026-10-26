// The verdict for each operation that creates, changes, opens, renders or exports a composition, read from the fresh read and the host's own evidence.
import { verifyCompositionSettings } from "./composition-settings.js";
import { hostVerification } from "./host-step.js";
import type { HostStep } from "./host-step.js";
import { numberField, textField } from "./json-fields.js";
import type { Request } from "./plan-request.js";
import type { SnapshotComposition, SnapshotLayer } from "./snapshot-reply.js";
import { compOf, layerIn, layerKey } from "./verify-context.js";
import type { VerifyContext } from "./verify-context.js";
import { verifyCompositionMarker } from "./verify-markers.js";
import { verifyRenderSettings } from "./verify-output.js";
import { exactStep, failedStep, judged, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { writtenFileVerdict } from "./written-file.js";

interface CompositionCall {
  readonly ctx: VerifyContext;
  readonly request: Request;
  readonly step: HostStep;
  readonly comp: SnapshotComposition;
}

const RENDER_BASES: Readonly<Record<string, string>> = {
  "render-submitted": "render-submission-host-evidence",
  "render-sent-to-media-encoder": "media-encoder-host-evidence",
};

const EVIDENCE_BASES: Readonly<Record<string, string>> = {
  export_frame: "frame-export-host-evidence",
  export_mogrt: "mogrt-export-host-evidence",
  set_composition_guides: "guides-not-in-snapshot",
};

function missingComposition(kind: string, ctx: VerifyContext): VerifiedStep {
  const ids = { compositionId: null };
  return ctx.snapshotTruncated ? unverifiedStep(kind, "composition-missing-truncated-snapshot", ids) : failedStep(kind, "composition-missing", ids);
}

function verifyRender(call: Omit<CompositionCall, "comp">, comp: SnapshotComposition | null): VerifiedStep {
  const { step } = call;
  const kind = call.request.operation;
  const compositionId = comp ? comp.id : null;
  const submission = step.verification ?? null;
  const basis = RENDER_BASES[step.verification ?? ""] ?? "render-queue-host-evidence";
  return verifyRenderSettings(kind, step, compositionId) ?? writtenFileVerdict(kind, step, { compositionId, submission }) ?? unverifiedStep(kind, basis, { compositionId, submission });
}

function precomposedLayer(call: CompositionCall): SnapshotLayer | null {
  const { ctx, request, step, comp } = call;
  return layerIn(comp, ctx.ids.layers.get(layerKey(comp.id, request.newLayerId)) || step.layerId);
}

function verifyPrecompose(call: CompositionCall): VerifiedStep {
  const { ctx, request, step, comp } = call;
  const kind = request.operation;
  const created = compOf(ctx, step.requestedNewCompositionId || request.newCompositionId);
  const layer = precomposedLayer(call);
  if (!created || !layer) return failedStep(kind, "precomp-missing", { compositionId: comp.id });
  const moved = (request.layerIds ?? []).filter((id) => layerIn(comp, id));
  if (moved.length > 0) return failedStep(kind, "precomposed-layers-still-in-parent", { compositionId: comp.id, layerIds: moved });
  const ids = { compositionId: comp.id, newCompositionId: created.id, layerId: layer.id };
  const sourced = layer.compositionSourceId === created.id || layer.sourceId === created.id;
  return sourced ? exactStep(kind, "precomp-created-and-layers-moved", ids) : unverifiedStep(kind, "precomp-layer-source-not-in-snapshot", ids);
}

function verifyOpened(call: CompositionCall): VerifiedStep {
  const { request, step, comp } = call;
  const kind = request.operation;
  const active = textField(step.row, "activeCompositionId");
  if (!active) return unverifiedStep(kind, "viewer-active-composition-not-reported", { compositionId: comp.id, ...hostVerification(step) });
  return judged(active === comp.id, kind, { pass: "viewer-active-composition", fail: "viewer-active-composition-mismatch" }, { compositionId: comp.id, ...(active === comp.id ? {} : { activeCompositionId: active }) });
}

function verifyEvidence(call: CompositionCall): VerifiedStep {
  const { request, step, comp } = call;
  const kind = request.operation;
  const details = { compositionId: comp.id, ...hostVerification(step) };
  const written = kind === "set_composition_guides" ? null : writtenFileVerdict(kind, step, details);
  return written ?? unverifiedStep(kind, EVIDENCE_BASES[kind] ?? "host-composition-evidence", { ...details, guideCount: numberField(step.row, "guideCount") ?? null });
}

function verifySettings(call: CompositionCall): VerifiedStep {
  return verifyCompositionSettings(call.request.operation, call.request.settings ?? {}, call.step, call.comp);
}

function verifyMarkers(call: CompositionCall): VerifiedStep {
  return verifyCompositionMarker(call.request, call.comp);
}

const OBSERVED_VERIFIERS: Readonly<Record<string, (call: CompositionCall) => VerifiedStep>> = {
  precompose_layers: verifyPrecompose,
  open_composition: verifyOpened,
  set_composition_guides: verifyEvidence,
  export_mogrt: verifyEvidence,
  export_frame: verifyEvidence,
  set_composition_settings: verifySettings,
  add_marker: verifyMarkers,
  update_marker: verifyMarkers,
  remove_marker: verifyMarkers,
};

function verifyAbsent(ctx: VerifyContext, request: Request, step: HostStep): VerifiedStep {
  const kind = request.operation;
  const exported = kind === "export_mogrt" || kind === "export_frame";
  const written = exported ? writtenFileVerdict(kind, step, { compositionId: step.compositionId ?? null, compositionObserved: false, ...hostVerification(step) }) : null;
  return written ?? missingComposition(kind, ctx);
}

function verifyResolved(base: Omit<CompositionCall, "comp">, comp: SnapshotComposition | null): VerifiedStep {
  const { ctx, request, step } = base;
  const kind = request.operation;
  if (kind === "create_composition" || kind === "duplicate_composition") return comp ? exactStep(kind, "composition-exists", { compositionId: comp.id }) : missingComposition(kind, ctx);
  if (kind === "render_composition") return verifyRender(base, comp);
  if (!comp) return verifyAbsent(ctx, request, step);
  const verifier = OBSERVED_VERIFIERS[kind];
  return verifier ? verifier({ ...base, comp }) : unverifiedStep(kind, "host-composition-evidence", { compositionId: comp.id });
}

/** The verdict for a composition operation, or for a marker operation that names no layer. */
export function verifyCompositionOperation(ctx: VerifyContext, index: number): VerifiedStep {
  const request = ctx.requests[index];
  const step = ctx.steps[index];
  if (!request || !step) return unverifiedStep("", "no-verifier-result");
  return verifyResolved({ ctx, request, step }, compOf(ctx, step.compositionId || request.compositionId || request.newCompositionId));
}

// ae_create_vector_artwork: checks the inline SVG and the names, then hands one plan to the proposal path.
import { aeVersionOf, svgImporterRoute, validateInlineSvg, vectorArtworkFallback } from "@extynt/action-plan";
import type { InlineSvgValidation } from "@extynt/action-plan";
import type { Infer, JsonObject } from "@extynt/decode";
import { findCompositionById } from "@extynt/project-graph";
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { ToolContext } from "./contracts.js";
import { toolError } from "./tool-result.js";
import { proposeCustomPlan } from "./edit-tools.js";
import { jsonFieldsOf, objectOf } from "./json.js";
import type { AE_CREATE_VECTOR_ARTWORK } from "./tool-specs-plan.js";
import type { ToolBase, ToolFailure, ToolResult } from "./tool-result.js";

type VectorArgs = Infer<typeof AE_CREATE_VECTOR_ARTWORK.input.decoder>;
type CheckedSvg = Extract<InlineSvgValidation, { ok: true }>;

const NAME_LIMIT = 256;

function nameIssue({ name }: VectorArgs): ToolFailure | undefined {
  return name.trim().length > 0 && name.length <= NAME_LIMIT ? undefined : toolError("INVALID_ARGUMENT", "name must contain 1-256 characters.");
}

function importModeIssue({ importMode }: VectorArgs): ToolFailure | undefined {
  if (importMode === "linked") return toolError("VECTOR_MODE_UNSUPPORTED", "Managed linked SVG footage is not yet supported: this build will not claim a safe linked-file lifecycle it cannot verify. Use importMode editable.");
  return undefined;
}

function layerNameIssue({ layerName }: VectorArgs): ToolFailure | undefined {
  return layerName === undefined || (layerName.length > 0 && layerName.length <= NAME_LIMIT) ? undefined : toolError("INVALID_ARGUMENT", "layerName must contain 1-256 characters.");
}

const ARGUMENT_CHECKS: ReadonlyArray<(args: VectorArgs) => ToolFailure | undefined> = [importModeIssue, nameIssue, layerNameIssue];

function targetTiming(args: VectorArgs, snapshot: ProjectSnapshot): JsonObject {
  const compositionId = args.targetCompositionId || snapshot.activeCompositionId;
  const composition = compositionId ? findCompositionById(snapshot, compositionId) : undefined;
  return composition ? { durationSeconds: composition.duration, frameRate: composition.frameRate } : {};
}

function importerRoute(context: ToolContext): JsonObject {
  const live = context.liveHost;
  if (!live || live.svgImport === "unknown") return jsonFieldsOf(svgImporterRoute({ hostKey: context.hostKey, ...(context.svgForceConverter === undefined ? {} : { forceConverter: context.svgForceConverter }) }));
  if (live.svgImport === "native") return context.svgForceConverter === true ? { importer: "converter" } : {};
  const version = aeVersionOf(live.version);
  return objectOf({ importer: "converter", importerAeVersion: version ?? undefined });
}

function artworkOperations(args: VectorArgs, checked: CheckedSvg, snapshot: ProjectSnapshot, context: ToolContext): ReadonlyArray<JsonObject> {
  const itemId = "__new__:vector-artwork";
  const name = args.name.trim();
  const compositionId = args.targetCompositionId;
  const artwork = objectOf({
    type: "create_vector_artwork", newItemId: itemId, name, svg: checked.svg,
    sourceHash: checked.metadata.sourceHash, metadata: jsonFieldsOf(checked.metadata), importMode: "editable", managedSourcePolicy: "retain",
    destinationFolderId: args.destinationFolderId,
    ...targetTiming(args, snapshot),
    ...jsonFieldsOf(vectorArtworkFallback(checked.svg)),
    ...importerRoute(context),
  });
  if (!compositionId) return [artwork];
  const layer = objectOf({ type: "create_layer", target: { compositionId, layerId: "__new__:vector-layer" }, layerType: "footage", sourceItemId: itemId, name: args.layerName ?? name });
  return [artwork, layer];
}

/** Proposes the plan that imports the caller's inline SVG as vector artwork, optionally layered into a composition. */
export function createVectorArtworkPlan(base: ToolBase, snapshot: ProjectSnapshot, args: VectorArgs, context: ToolContext): ToolResult {
  for (const check of ARGUMENT_CHECKS) {
    const issue = check(args);
    if (issue) return issue;
  }
  const checked = validateInlineSvg(args.svg);
  if (!checked.ok) return toolError(checked.code, checked.message);
  const operations = artworkOperations(args, checked, snapshot, context);
  return proposeCustomPlan(base, snapshot, { summary: `Create vector artwork — ${args.name.trim()}`, operations }, context);
}

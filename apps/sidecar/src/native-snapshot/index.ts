/** The native snapshot adapter's public surface: plugin read results to the probe envelope, the details call, the hash index and the apply breadcrumb. */
export { toProbeEnvelope } from "./envelope.js";
export { residualScopes } from "./details.js";
export { DETAIL_KINDS, KEY_DIGEST_FORMAT } from "./detail-kinds.js";
export { propertyDetail } from "./detail-shapes.js";
export { anyResult } from "./read-set.js";
export { parsePropertyDetails } from "./details-parse.js";
export { changedLayers, layerHashIndex, mergeLayersByHash } from "./hashes.js";
export { readApplyBreadcrumb } from "./breadcrumb.js";
export { DOCUMENTED_DIFFERENCES } from "./differences.js";
export { DETAILS_MAX_LAYERS } from "./types.js";
export type {
  ChangedLayers, CompositionDetails, CompositionMarkers, DetailKind, DetailScope, InterruptedApply, LayerDetails, LayerHashEntry, LayerHashIndex, NativeCompResult, NativeProjectResult, NativeReadScope,
  NativeReadSet, PlanReach, PropertyDetail, PropertyDetailsRequest, PropertyDetailsResult,
} from "./types.js";

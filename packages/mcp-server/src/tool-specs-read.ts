// The tools that read the open project: status, context, inspection, capture and checks.
import { arrayArg, enumArg, numberArg, optionalArg, stringArg, unionArg } from "./arg.js";
import { waitArg } from "./tool-shapes.js";
import { INSPECT_MAX_BUDGET_BYTES, INSPECT_MIN_BUDGET_BYTES } from "./inspection.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

export const AE_STATUS = defineTool("ae_status", {
  description: "extynt version, connection to After Effects (offline, busy or stalled, and why), host, model, snapshot freshness, and the newest work the agent applied with what its receipt says — status, applied, verified, undo groups. Works before a snapshot exists.",
  input: {},
});

export const AE_GET_BOOTSTRAP_CONTEXT = defineTool("ae_get_bootstrap_context", {
  description: "Start here. Profile/project/selection identities and counts; pass knownProfileId/knownRevision to get NOT_MODIFIED when unchanged.",
  input: {
    knownProfileId: optionalArg(stringArg()),
    knownRevision: optionalArg(stringArg()),
  },
});

export const AE_LIST_NATIVE_OPERATIONS = defineTool("ae_list_native_operations", {
  description: "Counts only (no operation list) for the typed native operation registry, including how many were verified exactly on this After Effects host. ae_search_native_operations lists the operations.",
  input: {},
});

export const AE_SEARCH_NATIVE_OPERATIONS = defineTool("ae_search_native_operations", {
  description: "Search typed operations: rows {planType, summary}; an empty query lists all; words rank by matches.",
  input: {
    query: optionalArg(stringArg()),
    limit: optionalArg(numberArg({ min: 1, max: 100 })),
  },
});

export const AE_DESCRIBE_NATIVE_OPERATION = defineTool("ae_describe_native_operation", {
  description: "The input schema and worked example for an operation, by registry id or plan type (e.g. animate_property); an array of up to 12 ids describes several in one call. A plan type served by several registry entries names the others. Describe only types you are about to write. detail \"full\" returns the whole registry entry for auditing.",
  input: {
    id: unionArg([
      stringArg(),
      arrayArg(stringArg(), { minItems: 1, maxItems: 12 }),
    ], { description: "One id, or up to 12 in an array for one entry each." }),
    detail: optionalArg(enumArg(["summary", "full"], { description: "summary (default): id, planType, status, input schema, example. full: the whole registry entry." })),
  },
});

const AE_GET_BUILD_KIT = defineTool("ae_get_build_kit", {
  description: "Everything needed to write the plans for a request, in one read: exact operation shapes, full field rows for the operation types the request names, units, and resolved examples for each feature it names. Pass the user's request verbatim; do not re-describe operations it shows.",
  input: {
    request: stringArg({ minLength: 1, maxLength: 20000 }),
  },
});

export const AE_GET_CURRENT_CONTEXT = defineTool("ae_get_current_context", {
  description: "Active composition, time, and selected layers (id, name, type, effects).",
  input: {},
});

export const AE_REFRESH_SNAPSHOT = defineTool("ae_refresh_snapshot", {
  description: "Re-probe After Effects after direct user edits; waits for the fresh snapshot and reports whether the project changed.",
  input: {
    waitSeconds: waitArg(10),
  },
});

export const AE_CAPTURE_COMPOSITION_FRAME = defineTool("ae_capture_composition_frame", {
  description: "Capture one local PNG frame (never uploaded, never edits). Waits and returns the image; previewMax* downscale it. Backgrounds are flattened (no alpha).",
  input: {
    compositionId: optionalArg(stringArg({ maxLength: 128 })),
    time: optionalArg(numberArg({ min: 0 })),
    previewMaxWidth: optionalArg(numberArg({ min: 16, max: 1920 })),
    previewMaxHeight: optionalArg(numberArg({ min: 16, max: 1920 })),
    maxEncodedBytes: optionalArg(numberArg({ min: 65536, max: 3000000 })),
    waitSeconds: waitArg(15),
  },
});

export const AE_GET_CAPTURE_FRAME = defineTool("ae_get_capture_frame", {
  description: "Retrieve a capture that was still pending when ae_capture_composition_frame returned; waits for it by default. captureId is required: it is the captureId field of the ae_capture_composition_frame result. A capture that already completed needs no retrieval; measure it with ae_observe_frame.",
  input: {
    captureId: stringArg({ minLength: 1, maxLength: 96 }),
    waitSeconds: waitArg(15),
  },
});

export const AE_OBSERVE_FRAME = defineTool("ae_observe_frame", {
  description: "Measure a capture in numbers instead of pixels: how much of the frame is drawn on, where that content sits (bounding box in frame coordinates), coverage of each cell of a 3x3 grid, the transparent share, and the dominant colours, with the background it was measured against. Use it to check anything visual you cannot see (did a wipe travel as asked - compare two times; is a counter inside the ring). Carries no image, so it works for a model that cannot read one.",
  input: {
    captureId: stringArg({ minLength: 1, maxLength: 96 }),
    waitSeconds: waitArg(15),
  },
});

const AE_CHECK_REQUEST = defineTool("ae_check_request", {
  description: "Read-only: am I done? Pass the user's request text; returns complete, the requested features still missing, layers placed off-frame, and the next step. Call it after applying a stage, before answering.",
  input: {
    request: stringArg({ minLength: 1, maxLength: 8000 }),
    compositionId: optionalArg(stringArg({ maxLength: 128 })),
  },
});

export const AE_GET_PROJECT_OVERVIEW = defineTool("ae_get_project_overview", {
  description: "Project summary: host, counts by type, warnings, truncation.",
  input: {},
});

export const AE_GET_SELECTION = defineTool("ae_get_selection", {
  description: "Selected layers with stable IDs.",
  input: {},
});

export const AE_FIND_PROJECT_OBJECTS = defineTool("ae_find_project_objects", {
  description: "Find layers by ID, name, or type.",
  input: {
    query: optionalArg(stringArg()),
    limit: optionalArg(numberArg()),
  },
});

export const AE_INSPECT_COMPOSITION = defineTool("ae_inspect_composition", {
  description: "Composition settings plus a per-layer summary (timing, non-default transform, effects, animated paths). Follow nextCursor.",
  input: {
    compositionId: optionalArg(stringArg()),
    limit: optionalArg(numberArg({ min: 1, max: 256 })),
    cursor: optionalArg(stringArg()),
    maxBytes: optionalArg(numberArg({ min: INSPECT_MIN_BUDGET_BYTES, max: INSPECT_MAX_BUDGET_BYTES })),
  },
});

export const AE_INSPECT_LAYER = defineTool("ae_inspect_layer", {
  description: "One layer's properties grouped by path. Default hides unanimated 3D/material/style/path-option groups (listed in omitted with counts); use pathPrefix or include:all to see them.",
  input: {
    compositionId: optionalArg(stringArg()),
    layerId: optionalArg(stringArg()),
    pathPrefix: optionalArg(stringArg({ maxLength: 512, description: "Only properties under this matchName path, e.g. ADBE Transform Group." })),
    include: optionalArg(enumArg(["core", "editable", "all"], { description: "core (default): editable minus unanimated noise groups; editable: all settable/animated; all: everything incl. read-only." })),
    limit: optionalArg(numberArg({ min: 1, max: 500 })),
    cursor: optionalArg(stringArg()),
    maxBytes: optionalArg(numberArg({ min: INSPECT_MIN_BUDGET_BYTES, max: INSPECT_MAX_BUDGET_BYTES })),
  },
});

export const AE_LIST_EFFECTS_AND_EXPRESSIONS = defineTool("ae_list_effects_and_expressions", {
  description: "Effects (controls as matchName|name=value) and expressions per layer. A value may carry where it sits in the range as reported by After Effects, e.g. 25 (12.5% of 0–200 pixels); that is its valid range, not the UI slider range.",
  input: {
    compositionId: optionalArg(stringArg()),
    layerId: optionalArg(stringArg()),
  },
});

export const AE_TRACE_DEPENDENCIES = defineTool("ae_trace_dependencies", {
  description: "Nested comp, parent, and matte relationships.",
  input: {
    compositionId: optionalArg(stringArg()),
    layerId: optionalArg(stringArg()),
  },
});

export const AE_LIST_PROJECT_ISSUES = defineTool("ae_list_project_issues", {
  description: "Structural warnings and layout risks: missing sources, locked layers, duplicate or superseded layer names, and enabled layers that are off-canvas, zero-scale, or transparent at the current time.",
  input: {
    compositionId: optionalArg(stringArg()),
  },
});

export const AE_MEASURE_LAYER = defineTool("ae_measure_layer", {
  description: "Where a layer really is, in composition pixels: its anchor point, 2D bounds and corners, and its layer-to-composition matrix with parents, anchor, scale and rotation resolved. Use it instead of reading raw Position whenever a layer is parented, has an offset anchor, or you need its edges. Values are the snapshot's at the current time; text and shape layers have no fixed size here.",
  input: {
    compositionId: stringArg(),
    layerId: stringArg(),
  },
});

/** The tools that read the open project: status, context, inspection, capture and checks. */
export const READ_TOOLS = [
  AE_STATUS,
  AE_GET_BOOTSTRAP_CONTEXT,
  AE_LIST_NATIVE_OPERATIONS,
  AE_SEARCH_NATIVE_OPERATIONS,
  AE_DESCRIBE_NATIVE_OPERATION,
  AE_GET_BUILD_KIT,
  AE_GET_CURRENT_CONTEXT,
  AE_REFRESH_SNAPSHOT,
  AE_CAPTURE_COMPOSITION_FRAME,
  AE_GET_CAPTURE_FRAME,
  AE_OBSERVE_FRAME,
  AE_CHECK_REQUEST,
  AE_GET_PROJECT_OVERVIEW,
  AE_GET_SELECTION,
  AE_FIND_PROJECT_OBJECTS,
  AE_INSPECT_COMPOSITION,
  AE_INSPECT_LAYER,
  AE_LIST_EFFECTS_AND_EXPRESSIONS,
  AE_TRACE_DEPENDENCIES,
  AE_LIST_PROJECT_ISSUES,
  AE_MEASURE_LAYER,
] satisfies ReadonlyArray<ToolEntry>;

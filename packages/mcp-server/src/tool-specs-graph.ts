// The retained-graph tools: cached queries and bounded native pages.
import { arrayArg, enumArg, freeObjectArg, numberArg, objectArg, optionalArg, stringArg } from "./arg.js";
import { waitArg } from "./tool-shapes.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

const AE_QUERY_GRAPH_CACHE = defineTool("ae_query_graph_cache", {
  description: "Query typed retained .extynt observations for the currently observed project without native dispatch. Rows from previous sessions/revisions are historical and stale. Empty/evicted/unobserved coverage is unknown, never absence. This does not authorize writes. Use ae_read_graph_page for current native evidence.",
  input: {
    target: objectArg({
      kind: enumArg(["index", "layers", "properties", "values"]),
      compositionId: optionalArg(stringArg()),
      layerId: optionalArg(stringArg()),
      propertyIndices: optionalArg(arrayArg(numberArg({ integer: true, min: 1 }), { maxItems: 16 })),
    }, { open: true }),
    cursor: optionalArg(numberArg({ integer: true, min: 0 })),
    limit: optionalArg(numberArg({ integer: true, min: 1, max: 25 })),
  },
});

const AE_READ_GRAPH_PAGE = defineTool("ae_read_graph_page", {
  description: "Demand a bounded native page from the After Effects plugin. Not for ordinary editing; inspections and plans keep reading the whole project. Sidecar owns cursors, revision checks and cache state. target.kind is index, layers, properties, values, blur (complete local static Gaussian Blur demand), or effect-create (exact absent Gaussian creation availability); every kind but index needs itemIndex and compositionId, and the layer kinds also need layerIndex and layerId: use returned stable IDs/ordinals, not names. Values require the descriptor page expectedStamp. Returns explicit unknown dependency coverage, never write authorization. Continue with jobId; no full rediscovery.",
  input: {
    target: optionalArg(objectArg({
      kind: optionalArg(enumArg(["index", "layers", "properties", "values", "blur", "effect-create"])),
      itemIndex: optionalArg(numberArg({ integer: true, min: 1 })),
      compositionId: optionalArg(stringArg()),
      layerIndex: optionalArg(numberArg({ integer: true, min: 1 })),
      layerId: optionalArg(stringArg()),
      propertyIndices: optionalArg(arrayArg(numberArg({ integer: true, min: 1 }), { maxItems: 16 })),
      expectedStamp: optionalArg(freeObjectArg()),
    }, { open: true })),
    jobId: optionalArg(stringArg()),
    startCursor: optionalArg(numberArg({ integer: true, min: 1 })),
    limit: optionalArg(numberArg({ integer: true, min: 1, max: 25 })),
    waitSeconds: waitArg(20),
  },
});

const AE_GET_GRAPH_PAGE = defineTool("ae_get_graph_page", {
  description: "Wait for an existing bounded demand without redispatching native work. Pending is unknown; observed pages carry native stamp/coverage; stale is not absent. Recovery guidance distinguishes waiting for the existing demand, fresh reconciliation and native quarantine. Never redispatch unresolved native work. This is infrastructure reconciliation, not model cache maintenance.",
  input: {
    demandId: stringArg({ maxLength: 128 }),
    waitSeconds: waitArg(20),
  },
});

/** The retained-graph tools: cached queries and bounded native pages. */
export const GRAPH_TOOLS = [
  AE_QUERY_GRAPH_CACHE,
  AE_READ_GRAPH_PAGE,
  AE_GET_GRAPH_PAGE,
] satisfies ReadonlyArray<ToolEntry>;

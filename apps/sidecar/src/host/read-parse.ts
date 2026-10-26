// Decoding of the plugin's read results: they arrive as JSON, so each member is checked before the snapshot adapter sees it.
import { array, boolean, fallback, literal, map, nullable, number, object, optional, presentFields, string } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import type { NativeReadResult } from "@extynt/host-native";
import { rowDecoder } from "../verify/json-fields.js";

const rows = map(array(rowDecoder), (list) => [...list]);
const texts = map(array(string()), (list) => [...list]);
const project = object({ name: string(), filePath: fallback(nullable(string()), null), dirty: fallback(boolean(), false) });

const nativeReadShape = object({
  source: literal("native"),
  project,
  compositions: rows,
  itemCount: optional(number()),
  selectedLayerIds: optional(nullable(texts)),
  warnings: optional(nullable(texts)),
  items: optional(fallback(rows, undefined)),
  sources: optional(fallback(rows, undefined)),
  activeCompositionId: optional(fallback(nullable(string()), undefined)),
  currentTime: optional(fallback(nullable(number()), undefined)),
  itemsHash: optional(fallback(string(), undefined)),
  projectHash: optional(fallback(string(), undefined)),
});

type Decoded = Infer<typeof nativeReadShape>;

function resultOf(read: Decoded): NativeReadResult {
  return {
    source: "native",
    project: read.project,
    itemCount: read.itemCount ?? 0,
    selectedLayerIds: read.selectedLayerIds ?? [],
    compositions: read.compositions,
    warnings: read.warnings ?? [],
    ...presentFields({
      items: read.items,
      sources: read.sources,
      activeCompositionId: read.activeCompositionId,
      currentTime: read.currentTime,
      itemsHash: read.itemsHash,
      projectHash: read.projectHash,
    }),
  };
}

/** Accepts a `read_project` or `read_comp` result; the members only some reads carry are dropped when malformed, and a missing list or count reads as empty. */
export const nativeReadResult: Decoder<NativeReadResult> = map(nativeReadShape, resultOf);

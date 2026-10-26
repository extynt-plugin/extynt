// The decoders of create_vector_artwork: the inline SVG inventory, the converter fallback it carries and the importer route; the types are what the decoders produce.
import { array, literal, number, optional, string, strictObject, tuple, type Infer, type ObjectOf } from "@extynt/decode";
import { folderReference, planIdentity, rgbColor } from "./operation-parts.js";
import { shapePath } from "./shape-decoder.js";

const inlineSvgMetadata = strictObject({
  bytes: number(), elements: number(), maxDepth: number(), pathCommands: number(), gradientStops: number(), gradients: number(), masks: number(), clipPaths: number(), sourceHash: string(),
});
const convertedFill = strictObject({ color: rgbColor, opacity: optional(number()), rule: optional(literal(1, 2)) });
const convertedStroke = strictObject({
  color: rgbColor, width: number(), opacity: optional(number()), cap: optional(literal(1, 2, 3)), join: optional(literal(1, 2, 3)), miterLimit: optional(number()),
});
const convertedShape = strictObject({ name: string(), paths: array(shapePath), fill: optional(convertedFill), stroke: optional(convertedStroke), opacity: optional(number()) });
const convertedLayer = strictObject({ name: string(), shapes: array(convertedShape) });
const conversionNotes = strictObject({ approximated: array(string()), skipped: array(string()) });
const fallbackFields = {
  fallbackLayers: optional(array(convertedLayer)), fallbackSize: optional(tuple(number(), number())), fallbackNotes: optional(conversionNotes), fallbackUnavailable: optional(string()),
} as const;
const routeFields = { importer: optional(literal("converter")), importerAeVersion: optional(string()) } as const;

export const createVectorArtworkOperation = strictObject({
  type: literal("create_vector_artwork"), newItemId: string(), ...planIdentity, name: string(), svg: string(), sourceHash: string(), metadata: inlineSvgMetadata,
  importMode: literal("editable"), managedSourcePolicy: literal("retain"), destinationFolderId: optional(folderReference), durationSeconds: optional(number()), frameRate: optional(number()),
  ...fallbackFields, ...routeFields,
});

export type InlineSvgMetadata = Infer<typeof inlineSvgMetadata>;
export type ConvertedFill = Infer<typeof convertedFill>;
export type ConvertedStroke = Infer<typeof convertedStroke>;
export type ConvertedShape = Infer<typeof convertedShape>;
export type ConvertedLayer = Infer<typeof convertedLayer>;
export type SvgConversionNotes = Infer<typeof conversionNotes>;
export type VectorArtworkFallback = ObjectOf<typeof fallbackFields>;
export type SvgImporterRoute = ObjectOf<typeof routeFields>;
export type CreateVectorArtworkOperation = Infer<typeof createVectorArtworkOperation>;

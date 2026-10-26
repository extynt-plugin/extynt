// create_vector_artwork: inline SVG source whose hash, metadata and converter fallback must equal what extynt derives from it.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isDeepStrictEqual } from "node:util";
import { isJsonObject } from "./json-shape.js";
import type { OperationContext } from "./layer-targets.js";
import { isCurrentIdentity } from "./plan-shape.js";
import { projectParentError } from "./project-item-rules.js";
import { vectorArtworkFallback } from "./svg-convert.js";
import { SVG_IMPORTER_VERSION_PATTERN } from "./svg-routing.js";
import { validateInlineSvg, type InlineSvgMetadata } from "./svg-validation.js";
import { ACCEPTED, invalid, isBoundedName, isOptionalFiniteInRange, isPlaceholderField, isPositiveFiniteUpTo, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

const FALLBACK_KEYS = ["fallbackLayers", "fallbackSize", "fallbackNotes", "fallbackUnavailable"] as const;
const METADATA_KEYS = ["bytes", "elements", "maxDepth", "pathCommands", "gradientStops", "gradients", "masks", "clipPaths", "sourceHash"] as const;
const VECTOR_ARTWORK_FIELDS = ["type", "newItemId", "snapshotFingerprint", "selectionFingerprint", "name", "svg", "sourceHash", "metadata", "importMode", "managedSourcePolicy", "destinationFolderId", "durationSeconds", "frameRate", "importer", "importerAeVersion", ...FALLBACK_KEYS];

function metadataMatches(value: JsonValue | undefined, expected: InlineSvgMetadata): boolean {
  if (!isJsonObject(value)) return false;
  return Object.keys(value).length === METADATA_KEYS.length && METADATA_KEYS.every((key) => value[key] === expected[key]);
}

function headerError(operation: JsonObject): Refusal | undefined {
  const durationSeconds = operation.durationSeconds;
  if (!isPlaceholderField(operation.newItemId) || !isBoundedName(operation.name, 256)) return invalid("INVALID_OPERATION", "create_vector_artwork requires a new item placeholder and a bounded name.");
  if (operation.importMode !== "editable") return invalid("VECTOR_MODE_UNSUPPORTED", "Only editable native-shape composition import is supported in this build; linked SVG footage is not yet supported.");
  if (durationSeconds !== undefined && !isPositiveFiniteUpTo(durationSeconds, 10_800)) return invalid("INVALID_VALUE", "durationSeconds must be a positive number up to 10800 (3 hours).");
  if (!isOptionalFiniteInRange(operation.frameRate, 1, 120)) return invalid("INVALID_VALUE", "frameRate must be a finite number from 1 through 120.");
  return operation.managedSourcePolicy === "retain" ? undefined : invalid("INVALID_VALUE", "Managed SVG sources must use retain policy because AE may keep a source relationship and Undo cannot remove disk files.");
}

function preambleError({ operation, plan }: OperationContext): Refusal | undefined {
  const unknownField = rejectUnknown(operation, VECTOR_ARTWORK_FIELDS);
  if (unknownField) return unknownField;
  if (!isCurrentIdentity(operation, plan)) return invalid("STALE_TARGET", "Vector artwork creation requires current snapshot identity.");
  return headerError(operation);
}

function inlineSvgOf(operation: JsonObject): string | Refusal {
  const svg = validateInlineSvg(operation.svg);
  if (!svg.ok) return invalid(svg.code, svg.message);
  if (operation.sourceHash !== svg.metadata.sourceHash || !metadataMatches(operation.metadata, svg.metadata)) return invalid("SVG_METADATA_MISMATCH", "SVG hash/metadata must match the exact inline source; use ae_create_vector_artwork so extynt computes them.");
  return svg.svg;
}

function fallbackError(operation: JsonObject, svg: string): Refusal | undefined {
  if (FALLBACK_KEYS.every((key) => operation[key] === undefined)) return undefined;
  const expected = vectorArtworkFallback(svg);
  const matches = FALLBACK_KEYS.every((key) => isDeepStrictEqual(operation[key], expected[key]));
  return matches ? undefined : invalid("SVG_FALLBACK_MISMATCH", "The converter fallback must be exactly what extynt derives from the inline SVG; use ae_create_vector_artwork so extynt computes it.");
}

function importerRouteError(operation: JsonObject): Refusal | undefined {
  const importer = operation.importer;
  const importerAeVersion = operation.importerAeVersion;
  const versionOk = importerAeVersion === undefined || (importer === "converter" && typeof importerAeVersion === "string" && SVG_IMPORTER_VERSION_PATTERN.test(importerAeVersion));
  return (importer === undefined || importer === "converter") && versionOk ? undefined : invalid("INVALID_VALUE", "importer must be \"converter\", and importerAeVersion a version number that comes with it.");
}

/**
 * create_vector_artwork: the fallback fields are derived data, so whatever the operation carries must equal what the converter
 * makes of its own svg. The importer route is chosen by the sidecar from the connected host, and the host reads only the
 * "converter" shape.
 */
export function validateCreateVectorArtwork(context: OperationContext): OperationResult {
  const problem = preambleError(context);
  if (problem) return problem;
  const svg = inlineSvgOf(context.operation);
  if (isRefusal(svg)) return svg;
  return fallbackError(context.operation, svg) ?? importerRouteError(context.operation) ?? projectParentError(context, "destinationFolderId") ?? ACCEPTED;
}

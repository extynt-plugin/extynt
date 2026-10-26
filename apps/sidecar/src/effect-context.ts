// The effect a native property row belongs to: its indices, names and relative path, validated against the row's own native indices.
import { absentAs, array, boolean, decodeOrCode, nullable, object, optional, string } from "@extynt/decode";
import type { Infer, JsonValue } from "@extynt/decode";
import { boundedText } from "./native-field-decoders.js";
import { countOrNull, indicesOrEmpty, textOr } from "./native-page.js";

const CODE = "INVALID_COLLECTION_EFFECT_CONTEXT";
const TEXT_LIMIT = 4096;
const OCCURRENCE_SUFFIX = /#(?:[2-9]|[1-9][0-9]+)$/;

const contextFacts = object({
  propertyIndices: indicesOrEmpty, relativeIndices: indicesOrEmpty, relativeMatchNames: array(boundedText(TEXT_LIMIT), { maxLength: 16 }),
  effectIndex: countOrNull, effectMatchName: textOr(""), effectName: textOr(""), effectEnabled: absentAs(nullable(boolean()), null),
  relativePath: optional(string({ maxLength: TEXT_LIMIT })),
});

/** The validated effect context of a property row. */
export interface EffectContext {
  effectIndex: number; effectMatchName: string; effectName: string; effectEnabled: boolean | null;
  relativeMatchNames: readonly string[]; relativeIndices: number[]; relativePath: string;
}

function escaped(name: string): string { return name.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/#/g, "%23"); }

/** The relative path built from the match names, with the separators inside names escaped. */
export function plainRelativePath(names: readonly string[]): string { return names.map(escaped).join("/"); }

/** A native path without the `#2` style suffixes the host adds to repeated names. */
export function nativeRelativePath(path: string): string { return path.split("/").map((segment) => segment.replace(OCCURRENCE_SUFFIX, "")).join("/"); }

type ContextFacts = Infer<typeof contextFacts>;

function indexMismatch(facts: ContextFacts): boolean {
  return facts.effectIndex === null || facts.effectIndex < 1 || facts.propertyIndices.at(-1) !== facts.effectIndex;
}

function pathMismatch(facts: ContextFacts, indices: readonly number[] | undefined): boolean {
  const expected = [...facts.propertyIndices, ...facts.relativeIndices].join("/");
  return facts.relativeMatchNames.length !== facts.relativeIndices.length || (indices ?? []).join("/") !== expected;
}

function relativePathMismatch(facts: ContextFacts, plain: string): boolean {
  return facts.relativePath !== undefined && nativeRelativePath(facts.relativePath) !== plain;
}

function contextMismatch(facts: ContextFacts, indices: readonly number[] | undefined, plain: string): boolean {
  return indexMismatch(facts) || pathMismatch(facts, indices) || relativePathMismatch(facts, plain);
}

/** Checks a row's effect context against the row's native indices; an absent context is undefined and a malformed one throws INVALID_COLLECTION_EFFECT_CONTEXT. */
export function validateEffectContext(context: JsonValue | undefined, indices: readonly number[] | undefined): EffectContext | undefined {
  if (context === undefined || context === null) return undefined;
  const facts = decodeOrCode(contextFacts, context, CODE);
  const plain = plainRelativePath(facts.relativeMatchNames);
  const { effectIndex, effectMatchName, effectName } = facts;
  if (contextMismatch(facts, indices, plain) || !effectMatchName || !effectName || effectIndex === null) throw Error(CODE);
  return {
    effectIndex, effectMatchName, effectName, effectEnabled: facts.effectEnabled,
    relativeMatchNames: facts.relativeMatchNames, relativeIndices: facts.relativeIndices, relativePath: facts.relativePath ?? plain,
  };
}

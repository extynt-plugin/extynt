// Validates inline SVG text before it reaches the host: size, nesting, element and attribute allow-lists, local-only references, finite numbers and a metadata inventory.
import { createHash } from "node:crypto";
import { SELF_CLOSING_TAG, stripCommentsAndDeclaration, XML_ATTRIBUTE, XML_TAG } from "./svg-xml.js";
import type { InlineSvgMetadata } from "./vector-artwork-decoder.js";

/** Deliberately conservative limits: large enough for authored artwork, small enough for one approval card and one host hop. */
export const INLINE_SVG_LIMITS = {
  maxBytes: 256 * 1024,
  maxDepth: 32,
  maxElements: 2_048,
  maxAttributesPerElement: 64,
  maxAttributeBytes: 32_768,
  maxPathCommands: 50_000,
  maxGradientStops: 256,
} as const;

export type { InlineSvgMetadata };

type InlineSvgFailure = { ok: false; code: "SVG_INVALID" | "SVG_UNSAFE" | "SVG_LIMIT_EXCEEDED"; message: string };

/** Either the accepted SVG (with the default namespace added when missing) and its metadata, or the first problem found. */
export type InlineSvgValidation = { ok: true; svg: string; metadata: InlineSvgMetadata } | InlineSvgFailure;

type Problem = InlineSvgFailure | undefined;
type Counter = "gradientStops" | "gradients" | "masks" | "clipPaths";

interface Attribute {
  name: string;
  value: string;
}

interface AttributeView extends Attribute {
  key: string;
  localName: string;
}

interface ElementScan {
  name: string;
  localName: string;
  seen: Set<string>;
}

interface Tally {
  elements: number;
  maxDepth: number;
  pathCommands: number;
  gradientStops: number;
  gradients: number;
  masks: number;
  clipPaths: number;
}

interface ScanState {
  stack: string[];
  cursor: number;
  tally: Tally;
}

interface PreparedSvg {
  ok: true;
  svg: string;
  source: string;
  tags: RegExpMatchArray[];
}

const FORBIDDEN_ELEMENTS = new Set(["script", "foreignobject", "iframe", "object", "embed", "image", "audio", "video", "canvas", "style", "use"]);
const URL_ATTRIBUTES = new Set(["href", "xlink:href", "src"]);
const FEATURE_COUNTERS: ReadonlyMap<string, Counter> = new Map<string, Counter>([
  ["stop", "gradientStops"],
  ["lineargradient", "gradients"],
  ["radialgradient", "gradients"],
  ["mask", "masks"],
  ["clippath", "clipPaths"],
]);
const UNSAFE_MARKUP: ReadonlyArray<readonly [RegExp, string]> = [
  [/<!DOCTYPE|<!ENTITY/iu, "DTD and entity declarations are not allowed."],
  [/<\?(?!xml\s)[\s\S]*?\?>/iu, "Processing instructions other than the XML declaration are not allowed."],
];
const FINITE_NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu;
const NON_FINITE_TOKEN = /(?:NaN|[+-]?Infinity)/iu;
const HEX_COLOUR = /#[0-9a-f]{3,8}\b/giu;
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/u;
const LOCAL_FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/u;
const ENTITY_REFERENCE = /&(?:#\d+|#x[0-9a-f]+|[a-z_][a-z0-9_.:-]*);/iu;
const EVENT_HANDLER = /^on[a-z]/u;
const FONT_RESOURCE = /(?:url\s*\(|https?:|file:|data:|@font-face)/iu;
const PATH_COMMAND = /[AaCcHhLlMmQqSsTtVvZz]/gu;
const ATTRIBUTE_TAIL = /^\/?>?$/u;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ROOT_TAG = /^(\s*(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*)<(svg)(?=[\s/>])([^<>]*)>/iu;
const MAX_ABSOLUTE_NUMBER = 1e9;

function fail(code: InlineSvgFailure["code"], message: string): InlineSvgFailure {
  return { ok: false, code, message };
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function localFragment(value: string): boolean {
  return LOCAL_FRAGMENT.test(value.trim());
}

function urlsSafe(value: string): boolean {
  let found = false;
  for (const match of value.matchAll(/url\(\s*([^)]+?)\s*\)/giu)) {
    found = true;
    const raw = (match[1] ?? "").trim().replace(/^(?:'([^']*)'|"([^"]*)")$/u, "$1$2");
    if (!localFragment(raw)) return false;
  }
  return found || !/\burl\s*\(/iu.test(value);
}

function matchEnd(match: RegExpMatchArray): number {
  return (match.index ?? 0) + match[0].length;
}

function attributeOf(match: RegExpMatchArray): Attribute {
  return { name: match[1] ?? "", value: match[2] ?? match[3] ?? "" };
}

function attributeEntries(rawTag: string): Attribute[] | undefined {
  const body = rawTag.replace(/^\s*[^\s/>]+/u, "");
  const entries: Attribute[] = [];
  let last = 0;
  for (const match of body.matchAll(XML_ATTRIBUTE)) {
    const entry = attributeOf(match);
    if (body.slice(last, match.index).trim() !== "" || !XML_NAME.test(entry.name)) return undefined;
    entries.push(entry);
    last = matchEnd(match);
  }
  return ATTRIBUTE_TAIL.test(body.slice(last).replace(/\s+/gu, "")) ? entries : undefined;
}

function viewOf(entry: Attribute): AttributeView {
  const key = entry.name.toLowerCase();
  return { ...entry, key, localName: key.split(":").at(-1) ?? key, value: entry.value.trim() };
}

function activeAttributeProblem(view: AttributeView): Problem {
  if (ENTITY_REFERENCE.test(view.value)) return fail("SVG_UNSAFE", `Entity references in ${view.name} are not allowed.`);
  if (EVENT_HANDLER.test(view.localName)) return fail("SVG_UNSAFE", `Event handler attribute ${view.name} is not allowed.`);
  if (view.key === "xml:base") return fail("SVG_UNSAFE", "xml:base is not allowed because it can turn local-looking references into external resources.");
  if (view.key === "style") return fail("SVG_UNSAFE", "Inline CSS style attributes are not allowed; use presentation attributes so AE import is deterministic.");
  return undefined;
}

function referenceProblem(view: AttributeView): Problem {
  const isReference = URL_ATTRIBUTES.has(view.key) || URL_ATTRIBUTES.has(view.localName);
  return isReference && view.value && !localFragment(view.value) ? fail("SVG_UNSAFE", `${view.name} may reference only an element inside this SVG.`) : undefined;
}

function fontProblem(view: AttributeView): Problem {
  const isFont = view.localName === "font-family" || view.localName === "font";
  return isFont && FONT_RESOURCE.test(view.value) ? fail("SVG_UNSAFE", "External or embedded fonts are not allowed.") : undefined;
}

function urlProblem(view: AttributeView): Problem {
  return urlsSafe(view.value) ? undefined : fail("SVG_UNSAFE", `${view.name} contains a non-local URL reference.`);
}

function numericProblem(view: AttributeView): Problem {
  if (NON_FINITE_TOKEN.test(view.value)) return fail("SVG_INVALID", `${view.name} contains a non-finite coordinate or value.`);
  for (const numeric of view.value.replace(HEX_COLOUR, " ").matchAll(FINITE_NUMBER)) {
    const number = Number(numeric[0]);
    if (!Number.isFinite(number) || Math.abs(number) > MAX_ABSOLUTE_NUMBER) return fail("SVG_INVALID", `${view.name} contains an out-of-range numeric value.`);
  }
  return undefined;
}

function attributeProblem(view: AttributeView): Problem {
  return activeAttributeProblem(view) ?? referenceProblem(view) ?? fontProblem(view) ?? urlProblem(view) ?? numericProblem(view);
}

function prepareSvg(input: string): PreparedSvg | InlineSvgFailure {
  const svg = input.replace(/^﻿/u, "").trim();
  if (!svg || utf8Bytes(svg) > INLINE_SVG_LIMITS.maxBytes) return fail("SVG_LIMIT_EXCEEDED", `SVG must be 1-${INLINE_SVG_LIMITS.maxBytes} UTF-8 bytes.`);
  const unsafe = UNSAFE_MARKUP.find(([pattern]) => pattern.test(svg));
  if (unsafe) return fail("SVG_UNSAFE", unsafe[1]);
  const source = stripCommentsAndDeclaration(svg);
  if (/<!/u.test(source)) return fail("SVG_UNSAFE", "XML declarations other than comments are not allowed.");
  const tags = [...source.matchAll(XML_TAG)];
  return tags.length ? { ok: true, svg, source, tags } : fail("SVG_INVALID", "SVG contains no elements.");
}

function interTagProblem(source: string, tag: RegExpMatchArray, state: ScanState): Problem {
  const between = source.slice(state.cursor, tag.index);
  state.cursor = matchEnd(tag);
  if (!state.stack.length && between.trim()) return fail("SVG_INVALID", "Text outside the root SVG is not allowed.");
  return ENTITY_REFERENCE.test(between) ? fail("SVG_UNSAFE", "Entity references are not allowed.") : undefined;
}

function closingTagProblem(raw: string, state: ScanState): Problem {
  const name = raw.slice(1).trim().toLowerCase();
  return !XML_NAME.test(name) || state.stack.pop() !== name ? fail("SVG_INVALID", `Mismatched closing element ${name || "(empty)"}.`) : undefined;
}

function openingNameProblem(element: ElementScan, state: ScanState): Problem {
  const { name, localName } = element;
  const { elements } = state.tally;
  if (!XML_NAME.test(name)) return fail("SVG_INVALID", "An element name is malformed.");
  if (!state.stack.length && elements > 0) return fail("SVG_INVALID", "SVG must contain exactly one root element.");
  if (elements === 0 && name !== "svg") return fail("SVG_INVALID", "The root element must be <svg>.");
  if (FORBIDDEN_ELEMENTS.has(localName)) return fail("SVG_UNSAFE", `<${name}> is not allowed in managed SVG artwork.`);
  state.tally.elements += 1;
  return state.tally.elements > INLINE_SVG_LIMITS.maxElements ? fail("SVG_LIMIT_EXCEEDED", `SVG exceeds ${INLINE_SVG_LIMITS.maxElements} elements.`) : undefined;
}

function oneAttributeProblem(attribute: Attribute, element: ElementScan, state: ScanState): Problem {
  const key = attribute.name.toLowerCase();
  if (element.seen.has(key)) return fail("SVG_INVALID", `<${element.name}> repeats attribute ${attribute.name}.`);
  element.seen.add(key);
  if (utf8Bytes(attribute.value) > INLINE_SVG_LIMITS.maxAttributeBytes) return fail("SVG_LIMIT_EXCEEDED", `${attribute.name} exceeds the attribute byte limit.`);
  const problem = attributeProblem(viewOf(attribute));
  if (problem) return problem;
  if (element.localName === "path" && key === "d") state.tally.pathCommands += (attribute.value.match(PATH_COMMAND) ?? []).length;
  return undefined;
}

function attributesProblem(raw: string, element: ElementScan, state: ScanState): Problem {
  const attributes = attributeEntries(raw);
  if (!attributes) return fail("SVG_INVALID", `<${element.name}> contains malformed or unquoted attributes.`);
  if (attributes.length > INLINE_SVG_LIMITS.maxAttributesPerElement) return fail("SVG_LIMIT_EXCEEDED", `<${element.name}> exceeds ${INLINE_SVG_LIMITS.maxAttributesPerElement} attributes.`);
  for (const attribute of attributes) {
    const problem = oneAttributeProblem(attribute, element, state);
    if (problem) return problem;
  }
  return state.tally.pathCommands > INLINE_SVG_LIMITS.maxPathCommands ? fail("SVG_LIMIT_EXCEEDED", `SVG exceeds ${INLINE_SVG_LIMITS.maxPathCommands} path commands.`) : undefined;
}

function countFeature(localName: string, state: ScanState): Problem {
  const counter = FEATURE_COUNTERS.get(localName);
  if (counter) state.tally[counter] += 1;
  return state.tally.gradientStops > INLINE_SVG_LIMITS.maxGradientStops ? fail("SVG_LIMIT_EXCEEDED", `SVG exceeds ${INLINE_SVG_LIMITS.maxGradientStops} gradient stops.`) : undefined;
}

function depthProblem(state: ScanState): Problem {
  return state.tally.maxDepth > INLINE_SVG_LIMITS.maxDepth ? fail("SVG_LIMIT_EXCEEDED", `SVG exceeds nesting depth ${INLINE_SVG_LIMITS.maxDepth}.`) : undefined;
}

function pushElement(name: string, state: ScanState): void {
  state.stack.push(name);
  state.tally.maxDepth = Math.max(state.tally.maxDepth, state.stack.length);
}

function openingTagProblem(raw: string, state: ScanState): Problem {
  const name = (/^([^\s/>]+)/u.exec(raw)?.[1] ?? "").toLowerCase();
  const element: ElementScan = { name, localName: name.split(":").at(-1) ?? name, seen: new Set() };
  const problem = openingNameProblem(element, state) ?? attributesProblem(raw, element, state) ?? countFeature(element.localName, state);
  if (problem) return problem;
  if (!SELF_CLOSING_TAG.test(raw)) pushElement(name, state);
  return depthProblem(state);
}

function tagProblem(tag: RegExpMatchArray, source: string, state: ScanState): Problem {
  const between = interTagProblem(source, tag, state);
  if (between) return between;
  const raw = (tag[1] ?? "").trim();
  if (!raw || raw.startsWith("!")) return fail("SVG_INVALID", "An SVG tag is malformed.");
  return raw.startsWith("/") ? closingTagProblem(raw, state) : openingTagProblem(raw, state);
}

function scanTags(prepared: PreparedSvg, state: ScanState): Problem {
  for (const tag of prepared.tags) {
    const problem = tagProblem(tag, prepared.source, state);
    if (problem) return problem;
  }
  if (prepared.source.slice(state.cursor).trim()) return fail("SVG_INVALID", "Text outside the root SVG is not allowed.");
  return state.stack.length ? fail("SVG_INVALID", `Unclosed element <${state.stack.at(-1)}>.`) : undefined;
}

function withDefaultNamespace(svg: string): string {
  return svg.replace(ROOT_TAG, (whole: string, lead: string, name: string, attributes: string) => (/(?:^|\s)xmlns\s*=/iu.test(attributes) ? whole : `${lead}<${name} xmlns="${SVG_NAMESPACE}"${attributes}>`));
}

function acceptedSvg(source: string, tally: Tally): InlineSvgValidation {
  const svg = withDefaultNamespace(source);
  const bytes = utf8Bytes(svg);
  if (bytes > INLINE_SVG_LIMITS.maxBytes) return fail("SVG_LIMIT_EXCEEDED", `SVG must be 1-${INLINE_SVG_LIMITS.maxBytes} UTF-8 bytes.`);
  const sourceHash = createHash("sha256").update(svg, "utf8").digest("hex");
  return { ok: true, svg, metadata: { bytes, ...tally, sourceHash } };
}

/**
 * Validates and inventories inline SVG text without expanding entities or resolving any resource.
 * After Effects' SVG reader may require the namespace declaration, so the accepted source always carries it and the hash is of that exact text.
 */
export function validateInlineSvgText(input: string): InlineSvgValidation {
  const prepared = prepareSvg(input);
  if (!prepared.ok) return prepared;
  const state: ScanState = { stack: [], cursor: 0, tally: { elements: 0, maxDepth: 0, pathCommands: 0, gradientStops: 0, gradients: 0, masks: 0, clipPaths: 0 } };
  return scanTags(prepared, state) ?? acceptedSvg(prepared.svg, state.tally);
}

/** Validates an svg field of unknown type: anything but text is invalid, text goes through validateInlineSvgText. */
export function validateInlineSvg<T>(input: T): InlineSvgValidation {
  return typeof input === "string" ? validateInlineSvgText(input) : fail("SVG_INVALID", "svg must be UTF-8 text.");
}

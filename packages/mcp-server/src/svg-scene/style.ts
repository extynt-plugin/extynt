// The painting properties of an SVG element: presentation attributes, then
// simple <style> rules (tag, .class, #id and their compounds), then the
// inline style attribute, with SVG's inheritance on top. Only what a vector
// shape can carry into After Effects is resolved; the rest is reported.
import type { SvgElement } from "./xml.js";

type FillRule = "nonzero" | "evenodd";
type LineCap = "butt" | "round" | "square";
type LineJoin = "miter" | "round" | "bevel";

/** The paint an element draws with once its declarations and its inheritance are resolved. */
export interface ComputedStyle {
  readonly fill: string;
  readonly fillOpacity: number;
  readonly fillRule: FillRule;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeOpacity: number;
  readonly strokeLinecap: LineCap;
  readonly strokeLinejoin: LineJoin;
  readonly strokeMiterlimit: number;
  readonly color: string;
  readonly visible: boolean;
}

/** The style of the document root before any declaration. */
export const DEFAULT_STYLE: ComputedStyle = { fill: "black", fillOpacity: 1, fillRule: "nonzero", stroke: "none", strokeWidth: 1, strokeOpacity: 1, strokeLinecap: "butt", strokeLinejoin: "miter", strokeMiterlimit: 4, color: "black", visible: true };

const STYLE_PROPERTIES = new Set(["fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "color", "visibility", "display", "opacity", "stroke-dasharray", "clip-path", "mask", "filter", "mix-blend-mode"]);

interface Selector { readonly tag?: string; readonly id?: string; readonly classes: readonly string[] }
/** One style rule: a simple selector, its declarations, and the order that settles ties. */
export interface CssRule { readonly selector: Selector; readonly declarations: Readonly<Record<string, string>>; readonly specificity: number; readonly order: number }

function parseSelector(text: string): Selector | undefined {
  const trimmed = text.trim();
  if (!/^[A-Za-z*]?[\w-]*(?:[.#][\w-]+)*$/u.test(trimmed) || !trimmed) return undefined;
  const tag = /^([A-Za-z][\w-]*)/u.exec(trimmed)?.[1]?.toLowerCase();
  const id = /#([\w-]+)/u.exec(trimmed)?.[1];
  const classes = [...trimmed.matchAll(/\.([\w-]+)/gu)].map((match) => match[1] ?? "");
  return { ...(tag ? { tag } : {}), ...(id ? { id } : {}), classes };
}

function specificityOf(selector: Selector): number {
  return (selector.id ? 100 : 0) + selector.classes.length * 10 + (selector.tag ? 1 : 0);
}

function parseDeclarations(text: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase(), value = part.slice(colon + 1).replace(/!important/giu, "").trim();
    if (STYLE_PROPERTIES.has(name) && value) declarations[name] = value;
  }
  return declarations;
}

function collectStyleText(element: SvgElement, into: string[]): void {
  if (element.name === "style") into.push(element.text);
  for (const child of element.children) collectStyleText(child, into);
}

/** Every simple rule in the document's <style> elements; selectors it cannot match exactly are left out. */
export function parseStyleSheets(root: SvgElement): CssRule[] {
  const texts: string[] = [];
  collectStyleText(root, texts);
  const rules: CssRule[] = [];
  const source = texts.join("\n").replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const declarations = parseDeclarations(match[2] ?? "");
    for (const text of (match[1] ?? "").split(",")) {
      const selector = parseSelector(text);
      if (selector) rules.push({ selector, declarations, specificity: specificityOf(selector), order: rules.length });
    }
  }
  return rules;
}

function selectorMatches(selector: Selector, element: SvgElement): boolean {
  if (selector.tag && selector.tag !== "*" && selector.tag !== element.name) return false;
  if (selector.id && selector.id !== element.attributes.id) return false;
  const classes = new Set((element.attributes.class ?? "").split(/\s+/u).filter(Boolean));
  return selector.classes.every((name) => classes.has(name));
}

/** Presentation attributes lose to rules, which lose to the inline style attribute. */
export function declaredProperties(element: SvgElement, rules: readonly CssRule[]): Record<string, string> {
  const declared: Record<string, string> = {};
  for (const [name, value] of Object.entries(element.attributes)) if (STYLE_PROPERTIES.has(name)) declared[name] = value.trim();
  const matching = rules.filter((rule) => selectorMatches(rule.selector, element)).sort((left, right) => left.specificity - right.specificity || left.order - right.order);
  for (const rule of matching) Object.assign(declared, rule.declarations);
  if (element.attributes.style) Object.assign(declared, parseDeclarations(element.attributes.style));
  return declared;
}

function number(value: string | undefined, fallback: number, min = 0, max = Number.POSITIVE_INFINITY): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  const scaled = value.trim().endsWith("%") ? parsed / 100 : parsed;
  return Math.min(max, Math.max(min, scaled));
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const lower = value?.trim().toLowerCase();
  return allowed.find((item) => item === lower) ?? fallback;
}

function inheritedValue(value: string | undefined, parent: string): string {
  return value === undefined || value.trim() === "inherit" ? parent : value.trim();
}

/** The style an element paints with: its own declarations over what it inherits. */
export function computeStyle(parent: ComputedStyle, declared: Readonly<Record<string, string>>): ComputedStyle {
  const color = inheritedValue(declared.color, parent.color);
  return {
    fill: inheritedValue(declared.fill, parent.fill),
    fillOpacity: number(declared["fill-opacity"], parent.fillOpacity, 0, 1),
    fillRule: oneOf(declared["fill-rule"], ["nonzero", "evenodd"], parent.fillRule),
    stroke: inheritedValue(declared.stroke, parent.stroke),
    strokeWidth: number(declared["stroke-width"], parent.strokeWidth, 0, 10_000),
    strokeOpacity: number(declared["stroke-opacity"], parent.strokeOpacity, 0, 1),
    strokeLinecap: oneOf(declared["stroke-linecap"], ["butt", "round", "square"], parent.strokeLinecap),
    strokeLinejoin: oneOf(declared["stroke-linejoin"], ["miter", "round", "bevel"], parent.strokeLinejoin),
    strokeMiterlimit: number(declared["stroke-miterlimit"], parent.strokeMiterlimit, 1, 100),
    color,
    visible: declared.visibility === undefined ? parent.visible : !["hidden", "collapse"].includes(declared.visibility.trim().toLowerCase()),
  };
}

/** opacity does not inherit: it multiplies down the tree. */
export function ownOpacity(declared: Readonly<Record<string, string>>): number {
  return number(declared.opacity, 1, 0, 1);
}

/** False when the element asks not to be displayed. */
export function displayed(declared: Readonly<Record<string, string>>): boolean {
  return declared.display?.trim().toLowerCase() !== "none";
}

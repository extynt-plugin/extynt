/**
 * Typed lookups into the fake After Effects host model: layers, properties, parades, shape roots, key values and eases. A
 * missing step throws, so a test reads a fixture without optional chains or casts.
 */

import { FakeEffectParade, FakeMaskParade, FakeShapeRoot, type FakeCompItem, type FakeLayer, type FakeProperty } from "./host-apply-host.js";
import type { FakeEase } from "./host-fake-property.js";
import { numberAt, plain, textAt } from "./json-narrow.js";
import { decodeOrThrow, number, object, type JsonValue } from "@extynt/decode";

type EaseSide = "inEase" | "outEase";

/** A looked-up fake that must exist; a missing one fails the test with `what` named. */
export function required<Fake>(found: Fake | null | undefined, what: string): Fake {
  if (found === null || found === undefined) throw new TypeError(`the fake host has no ${what}`);
  return found;
}

/** The element at `index`, or a thrown error naming the missing index. */
export function itemAt<Item>(items: ReadonlyArray<Item>, index: number): Item {
  return required(items[index], `element at index ${index}`);
}

/** The layer's top-level property with this match name. */
export function layerProperty(layer: FakeLayer, matchName: string): FakeProperty {
  return required(layer.properties.find((property) => property.matchName === matchName), `${matchName} on layer ${layer.id}`);
}

/** The layer's top-level property at a zero-based position. */
export function propertyAt(layer: FakeLayer, position: number): FakeProperty {
  return required(layer.properties[position], `property ${position} on layer ${layer.id}`);
}

/** The first child of a property with this match name. */
export function childNamed(parent: FakeProperty, matchName: string): FakeProperty {
  return required(parent.children.find((child) => child.matchName === matchName), `${matchName} under ${parent.matchName}`);
}

/** The children of a property with this match name, in order. */
export function childrenNamed(parent: FakeProperty, matchName: string): FakeProperty[] {
  return parent.children.filter((child) => child.matchName === matchName);
}

/** The last child of a property with this match name, which is the live one after a placeholder. */
export function lastChildNamed(parent: FakeProperty, matchName: string): FakeProperty {
  const matches = childrenNamed(parent, matchName);
  return itemAt(matches, matches.length - 1);
}

/** The descendant reached by following zero-based child positions. */
export function childAt(parent: FakeProperty, ...positions: number[]): FakeProperty {
  return positions.reduce((current, position) => required(current.children[position], `child ${position} of ${current.matchName}`), parent);
}

/** The layer's effect parade. */
export function effectParade(layer: FakeLayer): FakeEffectParade {
  return required(layer.properties.find((property) => property instanceof FakeEffectParade), `effect parade on layer ${layer.id}`);
}

/** The layer's shape contents root; throws when the layer is not a shape layer. */
export function shapeRoot(layer: FakeLayer): FakeShapeRoot {
  return required(layer.properties.find((property) => property instanceof FakeShapeRoot), `shape contents on layer ${layer.id}`);
}

/** The layer's Mask Parade; throws when the layer has none. */
export function maskParadeOf(layer: FakeLayer): FakeMaskParade {
  return required(layer.properties.find((property) => property instanceof FakeMaskParade), `masks on layer ${layer.id}`);
}

/** The path property of the layer's first mask. */
export function firstMaskPath(layer: FakeLayer): FakeProperty {
  return childAt(maskParadeOf(layer), 0, 0);
}

/** The composition's layer with this name. */
export function layerNamed(comp: FakeCompItem, name: string): FakeLayer {
  return required(comp.layerItems.find((layer) => layer.name === name), `layer ${name} in ${comp.id}`);
}

/** The fake layer at a zero-based index of a composition's layer stack. */
export function layerAt(comp: FakeCompItem, index: number): FakeLayer {
  return required(comp.layerItems[index], `layer ${index} of ${comp.id}`);
}

/** The title layer's Source Text property. */
export function sourceTextOf(layer: FakeLayer): FakeProperty {
  return childAt(layerProperty(layer, "ADBE Text Properties"), 0);
}

/** The Position property of a layer's Transform group. */
export function positionOf(layer: FakeLayer): FakeProperty {
  return childAt(layerProperty(layer, "ADBE Transform Group"), 0);
}

/** The title layer's Marker property. */
export function markerOf(layer: FakeLayer): FakeProperty {
  return layerProperty(layer, "ADBE Marker");
}

const justifiedDocument = object({ justification: number() });

/** The paragraph justification code on a text layer's source text. */
export function justificationOf(layer: FakeLayer): number {
  const document = childNamed(layerProperty(layer, "ADBE Text Properties"), "ADBE Text Document").value;
  return decodeOrThrow(justifiedDocument, document).justification;
}

/** The property's current value as JSON, without the functions a fake document carries. */
export function valueJson(property: FakeProperty): JsonValue {
  return plain(property.value);
}

/** A numeric field of the property's current JSON value. */
export function valueNumber(property: FakeProperty, ...path: string[]): number {
  return numberAt(valueJson(property), ...path);
}

/** The comment of the marker key at 1-based `index`. */
export function markerComment(marker: FakeProperty, index: number): string {
  return textAt(plain(marker.keyValue(index)), "comment");
}

/** Whether `actual` is within one billionth of `expected`. */
export function nearlyEqual(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 1e-9;
}

/** The ease samples a fake property recorded on one side of a key; empty when that key has none. */
export function easeSamples(property: FakeProperty, keyIndex: number, side: EaseSide): ReadonlyArray<FakeEase> {
  return property.temporalEase[keyIndex]?.[side] ?? [];
}

/** The first ease sample on one side of a key. */
export function easeSample(property: FakeProperty, keyIndex: number, side: EaseSide): FakeEase {
  return required(easeSamples(property, keyIndex, side)[0], `${side} sample on key ${keyIndex}`);
}

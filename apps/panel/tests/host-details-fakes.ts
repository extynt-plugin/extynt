/** A small fake After Effects property tree for the detail read: groups, leaves, keyframes, and a project that refuses every write. */

import { type JsonValue } from "@extynt/decode";

/** The PropertyType enum values the fake exposes. */
export const PROPERTY_TYPES = { PROPERTY: 6212, INDEXED_GROUP: 6213, NAMED_GROUP: 6214 };

/** The PropertyValueType enum values the fake exposes. */
export const VALUE_TYPES = { OneD: 1, TwoD: 2, ThreeD: 3, COLOR: 4, TwoD_SPATIAL: 5, ThreeD_SPATIAL: 6, LAYER_INDEX: 7, NO_VALUE: 8, CUSTOM_VALUE: 9, SHAPE: 10 };

/** A keyframe: its time and value. */
export type FakeKey = [time: number, value: JsonValue];

type FakePropTail = readonly [children?: FakeProp[], value?: JsonValue, keys?: FakeKey[]];

/** A property node that serves reads and throws on any write. */
export class FakeProp {
  public readonly keys: FakeKey[];
  public readonly children: FakeProp[];
  public readonly value: JsonValue;
  public valueType: number = VALUE_TYPES.OneD;

  public constructor(public readonly matchName: string, public readonly name: string, ...[children = [], value = null, keys = []]: FakePropTail) {
    this.children = children;
    this.value = value;
    this.keys = keys;
  }

  public get propertyType(): number {
    return this.children.length > 0 ? PROPERTY_TYPES.NAMED_GROUP : PROPERTY_TYPES.PROPERTY;
  }

  public get propertyValueType(): number {
    return this.valueType;
  }

  public get numProperties(): number {
    return this.children.length;
  }

  public get numKeys(): number {
    return this.keys.length;
  }

  public property(index: number): FakeProp | null {
    return this.children[index - 1] ?? null;
  }

  public keyTime(index: number): number {
    return this.keys[index - 1]?.[0] ?? -1;
  }

  public keyValue(index: number): JsonValue {
    return this.keys[index - 1]?.[1] ?? 0;
  }

  public setValue(): void {
    throw new Error("the detail read must not write");
  }

  public setValueAtTime(): void {
    throw new Error("the detail read must not write");
  }
}

/** A layer with a numeric id and a flat property list. */
export class FakeLayer {
  public constructor(public readonly id: number, public readonly name: string, public readonly properties: FakeProp[]) {}

  public get numProperties(): number {
    return this.properties.length;
  }

  public property(index: number): FakeProp | null {
    return this.properties[index - 1] ?? null;
  }
}

/** A composition with ordered layers and an optional marker track. */
export class FakeComp {
  public constructor(public readonly id: number, public readonly layers: FakeLayer[], public readonly markerProperty: FakeProp | null = null) {}

  public get numLayers(): number {
    return this.layers.length;
  }

  public layer(index: number): FakeLayer | null {
    return this.layers[index - 1] ?? null;
  }
}

/** A footage item, which the detail read must skip. */
export class FakeFootage {
  public constructor(public readonly id: number) {}
}

/** Any project item the fake serves. */
export type FakeItem = FakeComp | FakeFootage;

/** The fake `app`: a project that serves items and an undo and command surface that refuses every call. */
export interface FakeApp {
  readonly project: {
    readonly numItems: number;
    readonly item: (index: number) => FakeItem | null;
    readonly itemByID?: (id: number) => FakeItem | null;
  };
  readonly beginUndoGroup: () => never;
  readonly endUndoGroup: () => never;
  readonly executeCommand: () => never;
}

/** A path-like value: the four fields a mask or vector path exposes. */
export type FakePath = { vertices: JsonValue; inTangents: JsonValue; outTangents: JsonValue; closed: JsonValue };

const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];

const MARKERS: FakeKey[] = [
  [1, { comment: "A", duration: 0, chapter: "", url: "", label: 2, cuePointName: "" }],
  [3, { comment: "B", duration: 1.5, chapter: "C1", url: "u", label: 0, cuePointName: "cue" }],
];

function refuse(): never {
  throw new Error("the detail read must not touch undo or commands");
}

function keyed(matchName: string): FakeProp {
  return new FakeProp(matchName, matchName, [], 0, [[0, 1], [1, 5]]);
}

function sampleAnimator(): FakeProp {
  return new FakeProp("ADBE Text Animator", "Animator", [new FakeProp("ADBE Text Animator Properties", "Props", [keyed("ADBE Text Opacity")])]);
}

function sampleEffect(): FakeProp {
  return new FakeProp("ADBE Gaussian Blur 2", "Blur", [keyed("ADBE Gaussian Blur 2-0001"), new FakeProp("ADBE Gaussian Blur 2-0002", "Dimensions", [], 1)]);
}

function typed(prop: FakeProp, valueType: number): FakeProp {
  prop.valueType = valueType;
  return prop;
}

function shapeProp(matchName: string, value: JsonValue): FakeProp {
  return typed(new FakeProp(matchName, matchName, [], value), VALUE_TYPES.SHAPE);
}

/** A project that serves items by id and throws on anything that would change the project. */
export function fakeApp(items: FakeItem[], withItemById = true): FakeApp {
  const project = { numItems: items.length, item: (index: number) => items[index - 1] ?? null };
  if (!withItemById) return { project, beginUndoGroup: refuse, endUndoGroup: refuse, executeCommand: refuse };
  return { project: { ...project, itemByID: (id: number) => items.find((item) => item.id === id) ?? null }, beginUndoGroup: refuse, endUndoGroup: refuse, executeCommand: refuse };
}

/** Transform with a keyed Position, a text group (Source Text plus two repeated animators), and two repeated effects with keyed leaves. */
export function sampleLayer(id: number, name = "Title"): FakeLayer {
  const textDocument = { text: "Hello", fontSize: 40, fontFamily: "Arial", fontStyle: "Bold" };
  const sourceText = new FakeProp("ADBE Text Document", "Source Text", [], textDocument);
  const animators = new FakeProp("ADBE Text Animators", "Animators", [sampleAnimator(), sampleAnimator()]);
  return new FakeLayer(id, name, [
    new FakeProp("ADBE Text Properties", "Text", [sourceText, animators]),
    new FakeProp("ADBE Transform Group", "Transform", [keyed("ADBE Position"), new FakeProp("ADBE Opacity", "Opacity", [], 100)]),
    new FakeProp("ADBE Effect Parade", "Effects", [sampleEffect(), sampleEffect()]),
    new FakeProp("dropShadow/mode2", "Odd", [new FakeProp("a%b#c", "Odd leaf", [], 0, [[0, 2]])]),
  ]);
}

/** A Shape-like value: the four fields a mask or vector path exposes. */
export function fakePath(vertices: JsonValue, closed: JsonValue = true): FakePath {
  const perVertex = (pair: readonly number[]): JsonValue => (Array.isArray(vertices) ? vertices.map(() => pair) : vertices);
  return { vertices, inTangents: perVertex([0, 0]), outTangents: perVertex([1, -1]), closed };
}

/** A mask parade, a vector shape inside a group, a two-marker layer marker track and a layer-valued parent-style leaf. */
export function pathLayer(id: number, path: FakePath = fakePath(SQUARE)): FakeLayer {
  const mask = new FakeProp("ADBE Mask Atom", "Mask 1", [shapeProp("ADBE Mask Shape", path), new FakeProp("ADBE Mask Opacity", "Opacity", [], 100)]);
  const vectorGroup = new FakeProp("ADBE Vector Group", "Group 1", [new FakeProp("ADBE Vectors Group", "Contents", [shapeProp("ADBE Vector Shape", path)])]);
  return new FakeLayer(id, "Paths", [
    new FakeProp("ADBE Mask Parade", "Masks", [mask]),
    new FakeProp("ADBE Root Vectors Group", "Contents", [vectorGroup]),
    new FakeProp("ADBE Marker", "Marker", [], null, MARKERS),
    typed(new FakeProp("ADBE Time Remap Ref", "Ref", [], 4), VALUE_TYPES.LAYER_INDEX),
  ]);
}

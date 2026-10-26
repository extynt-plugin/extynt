// The parsed form of an SVG element: a discriminated union by role, so the converter switches on kind instead of testing tag names.

/** Attribute values by local name, trimmed. */
export type SvgAttributes = Readonly<Record<string, string>>;

const SHAPE_TAGS = ["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"] as const;
const CONTAINER_TAGS = ["g", "a", "switch", "svg"] as const;
const TEXT_TAGS = ["text", "tspan", "textpath"] as const;
const MAX_NAME_LENGTH = 256;

type ShapeTag = (typeof SHAPE_TAGS)[number];
type ContainerTag = (typeof CONTAINER_TAGS)[number];
type TextTag = (typeof TEXT_TAGS)[number];

interface ElementOf<Kind extends string, Name extends string> {
  readonly kind: Kind;
  readonly name: Name;
  readonly attrs: SvgAttributes;
  readonly children: SvgNode[];
}

/** An element the converter draws: it yields subpaths of its own. */
export type ShapeNode = ElementOf<"shape", ShapeTag>;

/** An element the converter only descends into. */
export type ContainerNode = ElementOf<"container", ContainerTag>;

/** Every element of a parsed SVG, by role: drawn shape, container, text (skipped) or anything else (ignored). */
export type SvgNode = ShapeNode | ContainerNode | ElementOf<"text", TextTag> | ElementOf<"other", string>;

function isTagOf<Tag extends string>(tags: readonly Tag[], name: string): name is Tag {
  return tags.some((tag) => tag === name);
}

/** A childless node for the lowercase local element name, classified by role. */
export function createNode(name: string, attrs: SvgAttributes): SvgNode {
  const children: SvgNode[] = [];
  if (isTagOf(SHAPE_TAGS, name)) return { kind: "shape", name, attrs, children };
  if (isTagOf(CONTAINER_TAGS, name)) return { kind: "container", name, attrs, children };
  if (isTagOf(TEXT_TAGS, name)) return { kind: "text", name, attrs, children };
  return { kind: "other", name, attrs, children };
}

/** The element's id when it is short enough to serve as a layer or shape name, otherwise its tag and `ordinal`. */
export function elementName(node: SvgNode, ordinal: number): string {
  const id = node.attrs.id;
  return id && id.length <= MAX_NAME_LENGTH ? id : `${node.name} ${ordinal}`;
}

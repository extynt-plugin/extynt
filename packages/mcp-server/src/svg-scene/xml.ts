/**
 * A small, bounded XML reader for scene designs. It builds an element tree and
 * nothing else: no entities beyond the five predefined and numeric references,
 * no DTDs, no external anything. Design SVG never reaches an importer or a
 * browser DOM from here; the compiler turns it into typed geometry.
 */

/** One parsed element: its lower-cased local name, attributes, child elements and the text between its tags. */
export interface SvgElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: SvgElement[];
  text: string;
}

const SVG_SCENE_LIMITS = { maxBytes: 262_144, maxElements: 4_096, maxDepth: 48 } as const;

/** A refusal to read or compile a scene design, carrying the code the caller reports. */
export class SvgSceneError extends Error {
  public constructor(public readonly code: "SVG_INVALID" | "SVG_LIMIT_EXCEEDED" | "SVG_UNSAFE" | "SVG_EMPTY", message: string) { super(message); }
}

const PREDEFINED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,4});/gu, (whole, body: string) => {
    if (body.startsWith("#x")) return safeCodePoint(Number.parseInt(body.slice(2), 16), whole);
    if (body.startsWith("#")) return safeCodePoint(Number.parseInt(body.slice(1), 10), whole);
    return PREDEFINED[body] ?? whole;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

/** The first `<svg ...>...</svg>` in a model reply, fenced or not; undefined when the reply holds none. */
export function extractSvg(text: string): string | undefined {
  const start = text.search(/<svg[\s>]/iu);
  if (start < 0) return undefined;
  const end = text.toLowerCase().lastIndexOf("</svg>");
  return end > start ? text.slice(start, end + "</svg>".length) : undefined;
}

interface Cursor { readonly source: string; index: number; elements: number }

const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gyu;

function skipSpace(body: string, from: number): number {
  const gap = /\s*/yu;
  gap.lastIndex = from;
  gap.exec(body);
  return gap.lastIndex;
}

function matchAttribute(body: string, position: number, tag: string): RegExpExecArray {
  ATTRIBUTE.lastIndex = position;
  const match = ATTRIBUTE.exec(body);
  if (match) return match;
  throw new SvgSceneError("SVG_INVALID", `A <${tagName(tag)}> attribute is malformed or unquoted near "${body.slice(position, position + 24)}".`);
}

function readAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const body = tag.replace(/^[^\s/>]+/u, "");
  for (let position = skipSpace(body, 0); position < body.length && body[position] !== "/"; position = skipSpace(body, ATTRIBUTE.lastIndex)) {
    const match = matchAttribute(body, position, tag);
    const key = match[1] ?? "";
    if (!(key in attributes)) attributes[key] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function tagName(tag: string): string { return (/^([^\s/>]+)/u.exec(tag)?.[1] ?? "").toLowerCase(); }

function skipSpecial(cursor: Cursor): boolean {
  const { source } = cursor;
  for (const [open, close] of [["<!--", "-->"], ["<![CDATA[", "]]>"], ["<?", "?>"]] as const) {
    if (!source.startsWith(open, cursor.index)) continue;
    const end = source.indexOf(close, cursor.index + open.length);
    if (end < 0) throw new SvgSceneError("SVG_INVALID", `An unterminated ${open} section.`);
    cursor.index = end + close.length;
    return true;
  }
  if (source.startsWith("<!", cursor.index)) throw new SvgSceneError("SVG_UNSAFE", "DTD and entity declarations are not accepted in a scene design.");
  return false;
}

function openElement(cursor: Cursor, stack: SvgElement[], raw: string): SvgElement | undefined {
  cursor.elements += 1;
  if (cursor.elements > SVG_SCENE_LIMITS.maxElements) throw new SvgSceneError("SVG_LIMIT_EXCEEDED", `A scene design may hold at most ${SVG_SCENE_LIMITS.maxElements} elements.`);
  const selfClosing = /\/\s*$/u.test(raw);
  const element: SvgElement = { name: localName(tagName(raw)), attributes: readAttributes(raw.replace(/\/\s*$/u, "")), children: [], text: "" };
  stack.at(-1)?.children.push(element);
  if (selfClosing) return element;
  stack.push(element);
  if (stack.length > SVG_SCENE_LIMITS.maxDepth) throw new SvgSceneError("SVG_LIMIT_EXCEEDED", `A scene design may nest at most ${SVG_SCENE_LIMITS.maxDepth} elements deep.`);
  return element;
}

function localName(name: string): string { return name.includes(":") ? name.slice(name.indexOf(":") + 1) : name; }

function closeElement(stack: SvgElement[], raw: string): void {
  const name = localName(tagName(raw.slice(1)));
  const open = stack.pop();
  if (!open || open.name !== name) throw new SvgSceneError("SVG_INVALID", `</${name}> closes <${open?.name ?? "nothing"}>.`);
}

function readTag(cursor: Cursor, stack: SvgElement[]): SvgElement | undefined {
  const end = cursor.source.indexOf(">", cursor.index);
  if (end < 0) throw new SvgSceneError("SVG_INVALID", "A tag is not closed with >.");
  const raw = cursor.source.slice(cursor.index + 1, end).trim();
  cursor.index = end + 1;
  if (!raw) throw new SvgSceneError("SVG_INVALID", "An empty tag.");
  if (raw.startsWith("/")) { closeElement(stack, raw); return undefined; }
  return openElement(cursor, stack, raw);
}

function readNext(cursor: Cursor, stack: SvgElement[]): SvgElement | undefined | null {
  const next = cursor.source.indexOf("<", cursor.index);
  if (next < 0) return null;
  const open = stack.at(-1);
  if (open) open.text += decodeEntities(cursor.source.slice(cursor.index, next));
  cursor.index = next;
  return skipSpecial(cursor) ? undefined : readTag(cursor, stack);
}

/** Parses one SVG document into its root element. */
export function parseSvgDocument(input: string): SvgElement {
  const source = input.replace(/^\uFEFF/u, "");
  if (Buffer.byteLength(source, "utf8") > SVG_SCENE_LIMITS.maxBytes) throw new SvgSceneError("SVG_LIMIT_EXCEEDED", `A scene design may be at most ${SVG_SCENE_LIMITS.maxBytes} bytes.`);
  const cursor: Cursor = { source, index: 0, elements: 0 };
  const stack: SvgElement[] = [];
  let root: SvgElement | undefined;
  for (let opened = readNext(cursor, stack); opened !== null; opened = readNext(cursor, stack)) root ??= opened;
  const unclosed = stack.at(-1);
  if (unclosed) throw new SvgSceneError("SVG_INVALID", `<${unclosed.name}> is never closed.`);
  if (!root || root.name !== "svg") throw new SvgSceneError("SVG_INVALID", "A scene design is one <svg> element.");
  return root;
}

// Reads the element tree of an SVG that validateInlineSvg already accepted: no entities, DTDs, CDATA or processing instructions remain.
import { createNode, type SvgAttributes, type SvgNode } from "./svg-node.js";

const COMMENT = /<!--[\s\S]*?-->/gu;
const XML_DECLARATION = /^\s*<\?xml\s[^?]*\?>/iu;

/** Matches one quoted attribute: name in group 1, value in group 2 (double quotes) or 3 (single quotes). */
export const XML_ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;

/** Matches one tag: its inside, without the angle brackets, in group 1. */
export const XML_TAG = /<([^<>]+)>/gu;

/** Matches the end of a self-closing tag's inside. */
export const SELF_CLOSING_TAG = /\/\s*$/u;

interface TreeState {
  readonly stack: SvgNode[];
  root: SvgNode | undefined;
}

/** The markup without comments and a leading XML declaration. */
export function stripCommentsAndDeclaration(svg: string): string {
  return svg.replace(COMMENT, "").replace(XML_DECLARATION, "");
}

function localName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1);
}

function readAttributes(body: string): SvgAttributes {
  const attrs: Record<string, string> = {};
  for (const match of body.matchAll(XML_ATTRIBUTE)) {
    const name = localName(match[1] ?? "");
    if (!(name in attrs)) attrs[name] = (match[2] ?? match[3] ?? "").trim();
  }
  return attrs;
}

function openingNode(raw: string): SvgNode | undefined {
  const head = /^([^\s/>]+)/u.exec(raw);
  if (!head?.[1]) return undefined;
  return createNode(localName(head[1]).toLowerCase(), readAttributes(raw.slice(head[0].length)));
}

function attach(node: SvgNode, tree: TreeState): boolean {
  const parent = tree.stack.at(-1);
  if (parent) {
    parent.children.push(node);
    return true;
  }
  if (tree.root) return false;
  tree.root = node;
  return true;
}

function readTag(raw: string, tree: TreeState): boolean {
  if (raw.startsWith("/")) {
    tree.stack.pop();
    return true;
  }
  const node = openingNode(raw);
  if (!node || !attach(node, tree)) return false;
  if (!SELF_CLOSING_TAG.test(raw)) tree.stack.push(node);
  return true;
}

/** The root element, or undefined when the markup is not one well-formed tree. */
export function parseSvgTree(svg: string): SvgNode | undefined {
  const tree: TreeState = { stack: [], root: undefined };
  for (const tag of stripCommentsAndDeclaration(svg).matchAll(XML_TAG)) if (!readTag((tag[1] ?? "").trim(), tree)) return undefined;
  return tree.stack.length === 0 ? tree.root : undefined;
}

/** Every element carrying an id, first one wins in document order, for gradient and paint lookups. */
export function indexIds(root: SvgNode): ReadonlyMap<string, SvgNode> {
  const ids = new Map<string, SvgNode>();
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    const id = node.attrs.id;
    if (id && !ids.has(id)) ids.set(id, node);
    pending.push(...[...node.children].reverse());
  }
  return ids;
}

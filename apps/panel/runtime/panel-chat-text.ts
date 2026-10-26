/** Chat text: the small markdown subset the model's replies use, drawn as DOM, and token number formatting. */
import { el } from "./panel-dom.js";
import { appendTable, tableAt } from "./panel-chat-table.js";

interface Block {
  readonly parent: HTMLElement;
  list: HTMLElement | null;
  listType: ListType | null;
  paragraph: string[];
}
type ListType = "ul" | "ol";
interface ListMatch {
  readonly text: string;
  readonly type: ListType;
}
interface Fence {
  readonly next: number;
  readonly text: string;
}

const THOUSAND = 1000;
const MILLION = 1000000;
const HUNDRED = 100;
const GROUP = 3;
const HEADINGS = ["h1", "h2", "h3"] as const;
const INLINE = /(`[^`\n]+`|\*\*[^*\s](?:[^*\n]*[^*\s])?\*\*|\*[^*\s](?:[^*\n]*[^*\s])?\*|\b_[^_\s](?:[^_\n]*[^_\s])?_\b|\[[^\]\n]*\]\([^)\s]*\))/g;

function finiteOrZero(value: number): number {
  return isFinite(value) ? Math.max(0, value) : 0;
}

/** "1.2K", "340K", "2.5M": a token count short enough for a chip. */
export function formatTokens(value: number): string {
  const count = finiteOrZero(value);
  if (count < THOUSAND) return String(Math.round(count));
  const scaled = count < MILLION ? count / THOUSAND : count / MILLION;
  return (scaled >= HUNDRED ? String(Math.round(scaled)) : String(Math.round(scaled * 10) / 10)) + (count < MILLION ? "K" : "M");
}

/** A token count with thousands separators: "12,345". */
export function formatExactTokens(value: number): string {
  const digits = String(Math.round(finiteOrZero(value)));
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= GROUP) groups.unshift(digits.slice(Math.max(0, end - GROUP), end));
  return groups.join(",");
}

/** The share of the prompt that came from the cache, to a tenth of a percent, or null when there is no prompt to compare. */
export function formatCacheHitPercent(cacheReadTokens: number, promptTokens: number): string | null {
  if (!isFinite(cacheReadTokens) || !isFinite(promptTokens) || promptTokens <= 0) return null;
  if (cacheReadTokens >= promptTokens) return "100";
  const units = Math.floor((Math.max(0, cacheReadTokens) * 2000 + promptTokens) / (2 * promptTokens));
  const whole = Math.floor(units / 10);
  if (whole >= HUNDRED) return "99.9";
  const tenths = units % 10;
  return tenths === 0 ? String(whole) : whole + "." + tenths;
}

function inlineNode(token: string): HTMLElement {
  const head = token.charAt(0);
  if (head === "`") return el("code", "", token.slice(1, -1));
  if (head === "*" && token.charAt(1) === "*") return el("strong", "", token.slice(2, -2));
  if (head === "*" || head === "_") return el("em", "", token.slice(1, -1));
  const split = token.indexOf("](");
  const link = el("span", "md-link", token.slice(1, split));
  link.title = token.slice(split + 2, -1);
  return link;
}

function appendInline(parent: HTMLElement, text: string): void {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    parent.appendChild(inlineNode(match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function isFence(line: string | undefined): boolean {
  return line !== undefined && /^\s*```/.test(line);
}

function fenceAt(lines: ReadonlyArray<string>, index: number): Fence | null {
  if (!isFence(lines[index])) return null;
  let end = index + 1;
  while (end < lines.length && !isFence(lines[end])) end += 1;
  return { next: end, text: lines.slice(index + 1, end).join("\n") };
}

function listAt(line: string): ListMatch | null {
  const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
  if (bullet) return { text: bullet[1] ?? "", type: "ul" };
  const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
  return numbered ? { text: numbered[1] ?? "", type: "ol" } : null;
}

function endList(block: Block): void {
  block.list = null;
  block.listType = null;
}

function flush(block: Block): void {
  if (block.paragraph.length === 0) return;
  const node = el("div", "para");
  appendInline(node, block.paragraph.join("\n"));
  block.parent.appendChild(node);
  block.paragraph = [];
}

function appendListItem(block: Block, match: ListMatch): void {
  if (!block.list || block.listType !== match.type) {
    block.list = el(match.type);
    block.listType = match.type;
    block.parent.appendChild(block.list);
  }
  const item = el("li");
  appendInline(item, match.text);
  block.list.appendChild(item);
}

function appendHeading(block: Block, hashes: string, text: string): void {
  const title = el(HEADINGS[hashes.length - 1] ?? "h3", "md-heading");
  appendInline(title, text.replace(/\s+$/, ""));
  block.parent.appendChild(title);
}

function closeBlocks(block: Block): void {
  flush(block);
  endList(block);
}

function consumeFence(block: Block, fence: Fence): number {
  closeBlocks(block);
  block.parent.appendChild(el("pre", "code-block", fence.text));
  return fence.next;
}

function consumeTable(block: Block, lines: ReadonlyArray<string>, index: number): number | null {
  const table = tableAt(lines, index);
  if (!table) return null;
  closeBlocks(block);
  appendTable(block.parent, table, appendInline);
  return table.last;
}

function consumeSpecial(block: Block, line: string): boolean {
  const heading = /^\s*(#{1,3})\s+(.*)$/.exec(line);
  if (heading) {
    closeBlocks(block);
    appendHeading(block, heading[1] ?? "###", heading[2] ?? "");
    return true;
  }
  if (!/^\s*-{3,}\s*$/.test(line)) return false;
  closeBlocks(block);
  block.parent.appendChild(el("hr", "md-rule"));
  return true;
}

function consumeLine(block: Block, lines: ReadonlyArray<string>, index: number): number {
  const line = lines[index] ?? "";
  const fence = fenceAt(lines, index);
  if (fence) return consumeFence(block, fence);
  if (consumeSpecial(block, line)) return index;
  const table = consumeTable(block, lines, index);
  if (table !== null) return table;
  const item = listAt(line);
  if (item) {
    flush(block);
    appendListItem(block, item);
    return index;
  }
  endList(block);
  if (line.trim()) block.paragraph.push(line);
  else flush(block);
  return index;
}

/** Draws the reply's markdown subset (fences, headings, rules, tables, lists, inline code, bold, italics and links) into `parent`. */
export function appendRichText(parent: HTMLElement, text: string): void {
  const lines = text.replace(/\r/g, "").split("\n");
  const block: Block = { parent, list: null, listType: null, paragraph: [] };
  for (let index = 0; index < lines.length; index += 1) index = consumeLine(block, lines, index);
  flush(block);
}

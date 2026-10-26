/** The stub DOM the panel contract suites run main.js against, built from the real index.html so a lookup of a missing id fails here, not in AE. */
import { readFileSync } from "node:fs";
import { type JsonValue } from "@extynt/decode";

/** A file as the composer's attach input, paste and drop hand it over. */
export type StubFile = { readonly name: string; readonly type: string; readonly size: number; readonly dataUrl: string };

/** The fields a test may add to a dispatched event. */
export type StubEventExtra = {
  readonly key?: string;
  readonly shiftKey?: boolean;
  readonly isComposing?: boolean;
  readonly detail?: JsonValue;
  readonly clipboardData?: { readonly files: ReadonlyArray<StubFile> };
  readonly dataTransfer?: { readonly types: ReadonlyArray<string>; readonly files?: ReadonlyArray<StubFile> };
  readonly preventDefault?: () => void;
};

/** An event as the panel's listeners receive it. */
export type StubEvent = StubEventExtra & { readonly type: string; readonly target: StubElement; readonly stopPropagation: () => void };

/** A listener the panel registered on a stub element, document or window. */
export type StubListener = (event: StubEvent) => void;

/** The inline style properties the panel sets. */
export type StubStyle = { width: string; height: string; left: string; top: string; maxHeight: string; flexGrow: string; aspectRatio: string };

let uidCounter = 0;

class StubClassList {
  public constructor(private readonly node: StubElement) {}
  private names(): Set<string> {
    return new Set(this.node.className.split(/\s+/).filter(Boolean));
  }
  public has(name: string): boolean {
    return this.names().has(name);
  }
  public contains(name: string): boolean {
    return this.has(name);
  }
  public toggle(name: string, force?: boolean): boolean {
    const names = this.names();
    const on = force === undefined ? !names.has(name) : force;
    if (on) names.add(name);
    else names.delete(name);
    this.node.className = Array.from(names).join(" ");
    return on;
  }
  public add(name: string): void {
    this.toggle(name, true);
  }
  public remove(name: string): void {
    this.toggle(name, false);
  }
}

/** A text node in the stub tree. */
export class StubTextNode {
  public readonly nodeType = 3;
  public parentNode: StubElement | null = null;
  public constructor(public textContent: string) {}
}

/** An element in the stub tree: enough of the DOM for the panel's own lookups, clicks and events. */
export class StubElement {
  public readonly uid = ++uidCounter;
  public tagName: string;
  public id = "";
  public childNodes: Array<StubElement | StubTextNode> = [];
  public parentNode: StubElement | null = null;
  public readonly attributes = new Map<string, string>();
  public className = "";
  public readonly style: StubStyle = { width: "", height: "", left: "", top: "", maxHeight: "", flexGrow: "", aspectRatio: "" };
  public readonly listeners = new Map<string, StubListener[]>();
  public hidden = false;
  public disabled = false;
  public checked = false;
  public value = "";
  public placeholder = "";
  public title = "";
  public type = "";
  public src = "";
  public alt = "";
  public open = false;
  public tabIndex = -1;
  public scrollTop = 0;
  public scrollHeight = 100;
  public offsetWidth = 0;
  public offsetHeight = 0;
  public focused = 0;
  public files: ReadonlyArray<StubFile> = [];
  public selectionStart: number | null = null;
  public selectionEnd: number | null = null;
  public selection: [number, number] | null = null;
  public rect: { top: number; bottom: number; left: number } | null = null;
  public readonly classList = new StubClassList(this);
  public onclick: StubListener | null = null;
  public onkeydown: StubListener | null = null;
  public constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  public getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number; height: number } {
    const box = this.rect ?? { top: 0, bottom: 0, left: 0 };
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.left + 260, width: 260, height: box.bottom - box.top };
  }
  public get firstChild(): StubElement | StubTextNode | null {
    return this.childNodes[0] ?? null;
  }
  public get isConnected(): boolean {
    for (let node: StubElement | null = this; node; node = node.parentNode) if (node.tagName === "BODY") return true;
    return false;
  }
  public get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
  public set textContent(text: string) {
    this.childNodes = [];
    if (text !== "") this.appendChild(new StubTextNode(text));
  }
  public appendChild<T extends StubElement | StubTextNode>(node: T): T {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  public removeChild<T extends StubElement | StubTextNode>(node: T): T {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  public insertBefore(node: StubElement | StubTextNode, reference: StubElement | StubTextNode | null): void {
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index < 0) {
      this.appendChild(node);
      return;
    }
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
  }
  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "class") this.className = value;
    if (name === "hidden") this.hidden = true;
  }
  public removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "hidden") this.hidden = false;
  }
  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  public addEventListener(type: string, listener: StubListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  public removeEventListener(type: string, listener: StubListener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }
  public dispatch(type: string, extra: StubEventExtra = {}): void {
    const event: StubEvent = { preventDefault: (): void => {}, stopPropagation: (): void => {}, ...extra, type, target: this };
    const direct = type === "click" ? this.onclick : type === "keydown" ? this.onkeydown : null;
    direct?.call(this, event);
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this, event);
  }
  public click(): boolean {
    if (this.disabled) return false;
    this.dispatch("click");
    return true;
  }
  public focus(): void {
    this.focused += 1;
  }
  public setSelectionRange(start: number, end: number): void {
    this.selection = [start, end];
  }
  public select(): void {}
  public blur(): void {}
  public scrollIntoView(): void {}
  public contains(node: StubElement | StubTextNode | null): boolean {
    return node instanceof StubElement && this.all((candidate) => candidate === node).length > 0;
  }
  public getElementsByTagName(tag: string): StubElement[] {
    const wanted = tag.toUpperCase();
    return this.all((node) => node.tagName === wanted && node !== this);
  }
  public querySelector(selector: string): StubElement | null {
    const test = selector.startsWith(".") ? (node: StubElement): boolean => node.classList.has(selector.slice(1)) : (node: StubElement): boolean => node.tagName === selector.toUpperCase();
    return this.find((node) => node !== this && test(node));
  }
  public all(predicate: (node: StubElement) => boolean, out: StubElement[] = []): StubElement[] {
    if (predicate(this)) out.push(this);
    for (const child of this.childNodes) if (child instanceof StubElement) child.all(predicate, out);
    return out;
  }
  public find(predicate: (node: StubElement) => boolean): StubElement | null {
    if (predicate(this)) return this;
    for (const child of this.childNodes) {
      const hit = child instanceof StubElement ? child.find(predicate) : null;
      if (hit) return hit;
    }
    return null;
  }
}

const DEFAULT_CHILDREN = new Map<string, ReadonlyArray<readonly [string, string]>>([
  ["chat-title", [["span", "chat-title-text"]]],
  ["context-chip", [["span", "ctx-chip-label"], ["span", "ctx-chip-text"]]],
  ["model-picker", [["span", "effort-label"]]],
]);

function attributesOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
    const [, name, text] = match;
    if (name) out.set(name, text ?? "");
  }
  return out;
}

function addDefaultChildren(node: StubElement): void {
  for (const [childTag, childClass] of DEFAULT_CHILDREN.get(node.id) ?? []) {
    const child = new StubElement(childTag);
    child.className = childClass;
    node.appendChild(child);
  }
}

function elementFor(match: RegExpMatchArray): StubElement | null {
  const [, tag, before, id, after] = match;
  if (!tag || !id) return null;
  const node = new StubElement(tag);
  const attributes = attributesOf((before ?? "") + " " + (after ?? ""));
  node.id = id;
  attributes.forEach((text, name) => node.setAttribute(name, text));
  node.className = attributes.get("class") ?? "";
  node.hidden = attributes.has("hidden");
  node.value = attributes.get("value") ?? "";
  addDefaultChildren(node);
  return node;
}

/** The page the panel boots into: the real markup's elements and panels, with the document calls the panel makes. */
export class StubDocument {
  public readonly elements = new Map<string, StubElement>();
  public readonly panels: StubElement[] = [];
  public readonly body = new StubElement("body");
  public readonly documentElement = new StubElement("html");
  public hidden = false;
  public activeElement: StubElement | null = null;
  public execCommand = (): boolean => false;
  public readonly listeners = new Map<string, StubListener[]>();
  public constructor() {
    const html = readFileSync("apps/panel/index.html", "utf8");
    for (const match of html.matchAll(/<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g)) {
      const node = elementFor(match);
      if (node) this.elements.set(node.id, node);
    }
    this.elements.forEach((node) => this.body.appendChild(node));
    this.buildPanels(html);
  }
  private buildPanels(html: string): void {
    for (const match of html.matchAll(/data-panel="(\w+)"([^>]*)>/g)) {
      const panel = new StubElement("div");
      panel.setAttribute("data-panel", match[1] ?? "");
      panel.hidden = /\bhidden\b/.test(match[2] ?? "");
      this.panels.push(panel);
      this.body.appendChild(panel);
    }
  }
  public getElementById(id: string): StubElement | null {
    return this.elements.get(id) ?? this.body.find((node) => node.id === id);
  }
  public createElement(tag: string): StubElement {
    return new StubElement(tag);
  }
  public createElementNS(_namespace: string, tag: string): StubElement {
    return new StubElement(tag);
  }
  public createTextNode(text: string): StubTextNode {
    return new StubTextNode(text);
  }
  public querySelectorAll(selector: string): StubElement[] {
    if (selector === "[data-panel]") return this.panels;
    const names = [...selector.matchAll(/\[([\w-]+)\]/g)].map((match) => match[1] ?? "");
    return [...this.elements.values()].filter((node) => names.some((name) => node.attributes.has(name)));
  }
  public addEventListener(type: string, listener: StubListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
}

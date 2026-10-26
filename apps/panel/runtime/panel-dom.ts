/**
 * DOM primitives and the element bindings the rest of the runtime reads. The shipped index.html carries every
 * binding below; the contract harness builds stub elements for the same ids. Elements are told apart by tag name, so
 * a lookup yields a typed element without a cast.
 */

function isButton(node: HTMLElement): node is HTMLButtonElement {
  return node.tagName === "BUTTON";
}

function isInput(node: HTMLElement): node is HTMLInputElement {
  return node.tagName === "INPUT";
}

function isSelect(node: HTMLElement): node is HTMLSelectElement {
  return node.tagName === "SELECT";
}

function isDetails(node: HTMLElement): node is HTMLDetailsElement {
  return node.tagName === "DETAILS";
}

function isTextarea(node: HTMLElement): node is HTMLTextAreaElement {
  return node.tagName === "TEXTAREA";
}

/** The element with this id, or null. */
export function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function typedById<T extends HTMLElement>(id: string, accepts: (node: HTMLElement) => node is T): T | null {
  const node = byId(id);
  return node !== null && accepts(node) ? node : null;
}

/** The button with this id, or null. */
export function buttonById(id: string): HTMLButtonElement | null {
  return typedById(id, isButton);
}

/** The input with this id, or null. */
export function inputById(id: string): HTMLInputElement | null {
  return typedById(id, isInput);
}

/** The drop-down list with this id, or null. */
export function selectById(id: string): HTMLSelectElement | null {
  return typedById(id, isSelect);
}

/** The disclosure element with this id, or null. */
export function detailsOf(id: string): HTMLDetailsElement | null {
  return typedById(id, isDetails);
}

/** The multi-line text field with this id, or null. */
export function textareaById(id: string): HTMLTextAreaElement | null {
  return typedById(id, isTextarea);
}

function required<T extends HTMLElement>(id: string, accepts: (node: HTMLElement) => node is T): T {
  const node = typedById(id, accepts);
  if (node === null) throw new Error("The panel markup has no element #" + id + " of the expected kind.");
  return node;
}

function requiredElement(id: string): HTMLElement {
  const node = byId(id);
  if (node === null) throw new Error("The panel markup has no element #" + id + ".");
  return node;
}

/** The Send / Steer button. */
export const chatButton = required("chat", isButton);
/** The message field. */
export const chatMessage = required("chat-message", isTextarea);
/** The scrolling transcript. */
export const chatOutput = requiredElement("chat-output");

/** Sets the text of the element with this id, if it exists. */
export function setText(id: string, text: string): void {
  const node = byId(id);
  if (node) node.textContent = text;
}

/** A new element with an optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The time of day as hh:mm:ss. */
export function clockTime(date: Date = new Date()): string {
  const pad = (n: number): string => (n < 10 ? "0" : "") + n;
  return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

/** Removes every child of the node. */
export function clearChildren(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

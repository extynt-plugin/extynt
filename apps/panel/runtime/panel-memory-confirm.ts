/**
 * Two-press delete buttons for Memory, like "Clear capture/chat history": the first press changes the label and arms
 * the button for a few seconds, the second press within that time does it. One button is armed at a time. Labels are
 * functions, so a button that is re-labelled after a language change says its words in the current language.
 */
import { press, type Armed } from "./panel-memory.js";
import { later } from "./panel-transport.js";

interface ConfirmSpec { readonly key: string; readonly idle: () => string; readonly armed: () => string; readonly run: () => void }

interface ArmedButton { readonly element: HTMLElement; readonly idle: () => string }

let armed: Armed | null = null;
let armedButton: ArmedButton | null = null;

function disarm(): void {
  if (armedButton) armedButton.element.textContent = armedButton.idle();
  armed = null;
  armedButton = null;
}

function arm(element: HTMLElement, spec: ConfirmSpec, next: Armed): void {
  armed = next;
  armedButton = { element, idle: spec.idle };
  element.textContent = spec.armed();
  later(() => { if (armed === next) disarm(); }, next.until - Date.now() + 50);
}

/** Wires `element` so that a second press under the same `key` runs `run`. The label returns to `idle` once the window passes. */
export function confirmOnSecondPress(element: HTMLElement, spec: ConfirmSpec): void {
  element.addEventListener("click", () => {
    const pressed = press(armed, spec.key, Date.now());
    disarm();
    if (pressed.fire) { spec.run(); return; }
    arm(element, spec, pressed.armed);
  });
}

/** Attaching a frame of the open composition to the next message: captured by the sidecar, held here until sent or removed. */
import type { Infer } from "@extynt/decode";
import { byId, clearChildren, el } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { onLanguageChange, t } from "./panel-language.js";
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import { uiState } from "./ui-state.js";
import { fallback, literal, number, object, string } from "@extynt/decode";

interface AttachedFrame {
  readonly captureId: string;
  readonly mediaType: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly time: number | null;
}

const captureDecoder = object({ ok: fallback(literal(true), false), dataUrl: fallback(string(), ""), captureId: fallback(string(), null), width: fallback(number(), 0), height: fallback(number(), 0), time: fallback(number(), null) });
type Capture = Infer<typeof captureDecoder>;

const MAX_FRAME_CHARS = 4000000;
const PREVIEW_WIDTH = 1568;
const PREVIEW_HEIGHT = 882;
const frameImages = new Map<string, string>();
let attached: AttachedFrame | null = null;
let capturing = false;

/** The frame waiting for the next message, if any. */
export function getAttachedFrame(): AttachedFrame | null {
  return attached;
}

/** Holds a frame for the next message, or drops it. */
export function setAttachedFrame(value: AttachedFrame | null): void {
  attached = value;
}

/** Repaints the attached frame strip in the new language when the interface language changes. */
export function wireAttachment(): void {
  onLanguageChange(renderAttachment);
}

/** The picture of a frame sent earlier, by its capture id. */
export function frameImageFor(captureId: string | undefined): string | null {
  return captureId ? frameImages.get(captureId) ?? null : null;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const rest = whole % 60;
  return Math.floor(whole / 60) + ":" + (rest < 10 ? "0" : "") + rest;
}

/** Draws the attached frame above the composer, or hides the strip. */
export function renderAttachment(): void {
  const box = byId("attach");
  if (!box) return;
  clearChildren(box);
  box.hidden = !attached;
  if (!attached) return;
  const image = el("img");
  image.src = attached.dataUrl;
  image.alt = t("chrome.attach.alt");
  box.appendChild(image);
  const note = attached.time !== null ? t("chrome.attach.sentAt", { time: clock(attached.time) }) : t("chrome.attach.sentNoTime");
  box.appendChild(el("span", "attach-note", note));
  const drop = el("button", "ghost", t("chrome.attach.remove"));
  drop.type = "button";
  drop.addEventListener("click", () => {
    attached = null;
    renderAttachment();
  });
  box.appendChild(drop);
}

function frameOf(result: Capture): AttachedFrame | null {
  const match = result.ok ? /^data:(image\/[a-z]+);base64,/.exec(result.dataUrl) : null;
  const mediaType = match?.[1];
  if (!mediaType || result.dataUrl.length > MAX_FRAME_CHARS) return null;
  return { captureId: result.captureId ?? "frame-" + Date.now().toString(36), mediaType, dataUrl: result.dataUrl, width: result.width, height: result.height, time: result.time };
}

function acceptCapture(result: Capture): void {
  const frame = frameOf(result);
  if (!frame) {
    hooks.notice(t("chrome.attach.failed"), "warn", null, true);
    return;
  }
  attached = frame;
  frameImages.set(frame.captureId, frame.dataUrl);
  renderAttachment();
}

/** The attach button: captures the open composition, or says why it cannot and offers the model settings. */
export function captureFrameForAttachment(): void {
  const state = uiState();
  if (!state.modelAcceptsImages) {
    hooks.notice(t("chrome.attach.noImages"), "warn", "switch-model", true);
    return;
  }
  if (!state.focus || !state.focus.compositionId) {
    hooks.notice(t("chrome.attach.noComposition"), "warn", null, true);
    return;
  }
  if (capturing) return;
  capturing = true;
  const path = "/v1/host/capture";
  const body = { compositionId: state.focus.compositionId, preview: { maxWidth: PREVIEW_WIDTH, maxHeight: PREVIEW_HEIGHT } };
  send({ method: "POST", path, body, context: transportContext("POST", path, diagnosticId("capture")), decoder: captureDecoder }, (reply) => {
    capturing = false;
    if (reply.ok) acceptCapture(reply.value);
    else hooks.notice(reply.error.reason || t("chrome.attach.failed"), "warn", null, true);
  });
}

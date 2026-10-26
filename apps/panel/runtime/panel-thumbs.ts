/** Before and after frames of a plan: held by the sidecar, fetched when a card needs them, drawn side by side. */
import { el } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { diagnosticId, pollContext, send } from "./panel-transport.js";
import { uiState } from "./ui-state.js";
import { fallback, map, object, string, union } from "@extynt/decode";

interface ThumbPair {
  readonly before: string | null;
  readonly after: string;
}

const MAX_PLANS = 20;
const cache = new Map<string, ThumbPair>();
const asked = new Set<string>();

const dataUrl = string({ pattern: /^data:image\// });
const imageDecoder = fallback(union(map(object({ dataUrl }), (frame) => frame.dataUrl), dataUrl), null);
const thumbsDecoder = object({ before: imageDecoder, after: imageDecoder });

/** The frames the panel holds for a plan, or null. */
export function thumbsFor(planId: string): ThumbPair | null {
  return cache.get(planId) ?? null;
}

function remember(planId: string, pair: ThumbPair): void {
  cache.delete(planId);
  cache.set(planId, pair);
  for (const oldest of cache.keys()) {
    if (cache.size <= MAX_PLANS) break;
    cache.delete(oldest);
  }
}

/** Asks the sidecar for a plan's frames; `done` gets true when the after frame arrived (the before frame may be missing). A plan the sidecar has none for is not an error. */
export function fetchThumbs(planId: string, done: (found: boolean) => void): void {
  if (!uiState().prefs.showThumbnails) { done(false); return; }
  if (cache.get(planId)?.before) { done(true); return; }
  if (asked.has(planId)) { done(false); return; }
  asked.add(planId);
  const path = "/v1/thumbs/" + encodeURIComponent(planId);
  send({ method: "GET", path, body: null, context: pollContext("GET", "/v1/thumbs", diagnosticId("thumbs")), decoder: thumbsDecoder }, (reply) => {
    asked.delete(planId);
    const after = reply.ok ? reply.value.after : null;
    if (reply.ok && after) remember(planId, { before: reply.value.before, after });
    done(after !== null);
  });
}

function frame(label: string, url: string | null, waiting: boolean): HTMLElement {
  const cell = el("span", "thumb");
  if (url) {
    const picture = el("img");
    picture.src = url;
    picture.alt = t("chrome.thumbs.frameAlt", { label });
    cell.appendChild(picture);
  } else {
    cell.appendChild(el("span", waiting ? "thumb-skeleton" : "thumb-empty"));
  }
  cell.appendChild(el("span", "thumb-cap", label));
  return cell;
}

/** The pair as one button that makes the frames larger, with skeletons holding the space until the frames arrive. */
export function thumbPairNode(pair: ThumbPair | null): HTMLElement {
  const node = el("button", "thumb-pair");
  node.type = "button";
  node.setAttribute("aria-expanded", "false");
  node.title = pair ? t("chrome.thumbs.showLarger") : t("chrome.thumbs.loading");
  node.setAttribute("aria-label", pair ? t("chrome.thumbs.pairLabel") : t("chrome.thumbs.pairLoading"));
  node.appendChild(frame(t("chrome.thumbs.before"), pair ? pair.before : null, !pair));
  node.appendChild(frame(t("chrome.thumbs.after"), pair ? pair.after : null, !pair));
  if (pair) {
    node.addEventListener("click", () => {
      const open = node.getAttribute("aria-expanded") !== "true";
      node.setAttribute("aria-expanded", open ? "true" : "false");
      node.title = open ? t("chrome.thumbs.showSmaller") : t("chrome.thumbs.showLarger");
    });
  }
  return node;
}

/**
 * The sheet's "Waiting for you": the detail of everything the status bar asks about. Read-only on purpose: the buttons that
 * answer these (Apply, Discard, Use this, Continue) are in the bar and nowhere else. A variant's tiles can be marked to choose
 * which one the bar's confirm will use; marking is not choosing.
 */
import { ageText } from "./panel-changes.js";
import { el } from "./panel-dom.js";
import { touchStatus } from "./panel-status-signal.js";
import type { WaitingItem } from "./panel-bar.js";
import { expressionBlocks, noticesBlock, rowsBlock } from "./panel-plan-parts.js";
import { planRowsOf, uncheckedCount } from "./panel-plan-labels.js";
import { planMessageFor, waitingPlans } from "./panel-plans.js";
import { openVariants, selectVariant, type VariantEntry } from "./panel-variants-view.js";
import { valueWords } from "./panel-variants.js";
import { t } from "./panel-language.js";

const expanded = new Set<string>();

export function section(title: string, count?: number): HTMLElement {
  const box = el("section", "sheet-section");
  box.appendChild(el("h2", "sheet-title", count !== undefined ? title + " · " + count : title));
  return box;
}

function planDetail(item: WaitingItem): HTMLElement[] {
  const message = planMessageFor(item.id), out: HTMLElement[] = [];
  if (!message) return out;
  const rows = planRowsOf(message.rows, message.operations);
  out.push(...rowsBlock(rows, expanded.has(item.id), () => {
      expanded.add(item.id);
      touchStatus();
    }));
  out.push(...expressionBlocks(message.expressions));
  out.push(...noticesBlock(message.notices, message.warnings));
  const unchecked = uncheckedCount(message.notices);
  if (unchecked > 0) out.push(el("div", "plan-sub wait", t("status.plan.uncheckedChanges", { count: unchecked })));
  const plan = waitingPlans().filter((entry) => entry.planId === item.id)[0];
  const asked = plan && plan.updatedAt ? ageText(plan.updatedAt, Date.now()) : "";
  out.push(el("div", "plan-sub", asked ? t("status.plan.sourceAsked", { source: item.source, asked: asked }) : t("status.plan.source", { source: item.source })));
  return out;
}

function pictureNode(entry: VariantEntry, candidate: VariantEntry["set"]["candidates"][number]): HTMLElement | null {
  const picture = entry.pictures[candidate.index];
  if (!picture) return null;
  const slot = el("div", "variant-pic");
  const image = el("img");
  const frame = entry.set.frame;
  image.src = picture;
  image.alt = t("status.variant.preview", { label: candidate.label });
  if (frame && frame.width > 0 && frame.height > 0) image.style.aspectRatio = frame.width + " / " + frame.height;
  slot.appendChild(image);
  return slot;
}

function tile(entry: VariantEntry, index: number): HTMLElement {
  const candidate = entry.set.candidates[index];
  if (!candidate) return el("span");
  const marked = entry.selected === candidate.index;
  const box = el("button", "variant-tile" + (marked ? " on" : ""));
  box.type = "button";
  box.setAttribute("aria-pressed", marked ? "true" : "false");
  box.disabled = entry.sending;
  const picture = pictureNode(entry, candidate);
  if (picture) box.appendChild(picture);
  box.appendChild(el("div", "variant-label", candidate.label));
  box.appendChild(el("div", "variant-value", valueWords(candidate.value) + (candidate.current ? " · " + t("status.variant.current") : "")));
  box.addEventListener("click", () => selectVariant(entry.set.setId, candidate.index));
  return box;
}

function variantDetail(item: WaitingItem): HTMLElement[] {
  const entry = openVariants().filter((candidate) => candidate.set.setId === item.id)[0];
  if (!entry) return [];
  const tiles = el("div", "variant-tiles");
  entry.set.candidates.forEach((_candidate, index) => tiles.appendChild(tile(entry, index)));
  const out = [tiles, el("div", "plan-sub", t("status.variant.mark"))];
  if (entry.note && entry.noteTone !== "bad") out.push(el("div", "plan-sub variant-status wait", entry.note));
  return out;
}

function itemNode(item: WaitingItem, current: boolean, position: number): HTMLElement {
  const box = el("div", "sheet-item" + (current ? " current" : ""));
  const head = el("div", "sheet-item-head");
  head.appendChild(el("span", "sheet-item-title", item.title));
  if (item.external) head.appendChild(el("span", "source-tag", item.source));
  if (!current) head.appendChild(el("span", "sheet-item-next", position === 1 ? t("status.sheet.next") : t("status.sheet.queued")));
  box.appendChild(head);
  const detail = item.kind === "plan" ? planDetail(item) : item.kind === "variant" ? variantDetail(item) : [el("div", "plan-sub", item.detail)];
  detail.forEach((node) => box.appendChild(node));
  return box;
}


export function waitingSection(items: ReadonlyArray<WaitingItem>, at: number): HTMLElement {
  const box = section(t("status.sheet.waiting"), items.length);
  items.forEach((item, index) => box.appendChild(itemNode(item, index === at, index - at)));
  return box;
}

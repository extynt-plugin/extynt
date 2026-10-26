/**
 * The variant question: when the agent puts a choice of values for one control to the user, the sheet's Waiting section shows
 * the question and two to four tiles, and the amber status bar holds the one confirm: "Use <label>" and "None of these".
 * What it says comes from panel-variants.ts; a confirm is sent to the sidecar once and the plan it leaves goes through the
 * ordinary Apply path, so nothing here applies anything or decides a value.
 */
import { hooks } from "./panel-hooks.js";
import { t } from "./panel-language.js";
import { touchStatus } from "./panel-status-signal.js";
import { markPicked } from "./panel-plan-state.js";
import { upsertPlanMessage } from "./panel-plans.js";
import { subscribeUi, uiState } from "./ui-state.js";
import {
  choiceAnswer, closedLine, failedLine, failureLine, isFinal, outcomeLine, previewAnswer, variantSetsAnswer, type ChoiceAnswer, type VariantCandidate, type VariantSet
} from "./panel-variants.js";
import { diagnosticId, send, transportContext, type TransportError } from "./panel-transport.js";

type NoteTone = "" | "wait" | "ok" | "bad";

/** One question as the panel holds it: the sidecar's set, the tile the reader marked, any pictures, and what the last press said. */
export interface VariantEntry {
  set: VariantSet; selected: number; readonly pictures: Record<number, string>; sending: boolean; closed: boolean; note: string; noteTone: NoteTone;
}

const PREVIEW_TIMEOUT_MS = 45000;
const entries = new Map<string, VariantEntry>();
const asked = new Set<string>();
let loading = false;
let again = false;

function firstOffered(set: VariantSet): VariantCandidate {
  return set.candidates.find((candidate) => !candidate.current) ?? set.candidates[0];
}

/** The questions still waiting on the reader, oldest first. */
export function openVariants(): ReadonlyArray<VariantEntry> {
  return [...entries.values()].filter((entry) => !entry.closed && entry.set.status === "open");
}

/** The tile the confirm will use: the one marked, else the first that is not the current value. */
export function selectedCandidate(entry: VariantEntry): VariantCandidate {
  return entry.set.candidates.find((candidate) => candidate.index === entry.selected) ?? firstOffered(entry.set);
}

/** Marks a tile; nothing is sent. */
export function selectVariant(setId: string, index: number): void {
  const entry = entries.get(setId);
  if (!entry || entry.closed || entry.sending) return;
  entry.selected = index;
  touchStatus();
}

function say(entry: VariantEntry, line: string, tone: NoteTone): void {
  entry.note = line;
  entry.noteTone = tone;
  touchStatus();
}

function close(entry: VariantEntry, line: string, tone: NoteTone): void {
  entry.closed = true;
  say(entry, line, tone);
  if (line && tone === "bad") hooks.notice(line, "warn");
}

function applyPicked(answer: ChoiceAnswer): void {
  const plan = answer.plan;
  if (!plan) { hooks.notice(t("chat.variants.chosenNoPlan"), "warn"); return; }
  markPicked(plan.planId);
  upsertPlanMessage({ ...plan, text: plan.title ?? "", title: plan.title ?? "", status: "prepared" });
  hooks.refreshPlans();
}

function answered(entry: VariantEntry, index: number | "none", answer: ChoiceAnswer): void {
  const candidate = entry.set.candidates.find((candidate) => candidate.index === index) ?? null;
  entry.sending = false;
  if (!answer.outcome) { say(entry, failedLine(), "bad"); return; }
  close(entry, outcomeLine(answer.outcome, candidate), "ok");
  if (answer.outcome === "picked") applyPicked(answer);
}

function refused(entry: VariantEntry, error: TransportError): void {
  entry.sending = false;
  if (isFinal(error)) { close(entry, failureLine(error), "bad"); return; }
  say(entry, failureLine(error), "bad");
}

/** Sends the one answer. A press while one is out, or after the question closed, sends nothing. */
export function chooseVariant(setId: string, index: number | "none"): void {
  const entry = entries.get(setId);
  if (!entry || entry.sending || entry.closed) return;
  entry.sending = true;
  say(entry, t("chat.variants.choosing"), "wait");
  const context = transportContext("POST", "/v1/variants/choose", diagnosticId("variants"));
  send({ method: "POST", path: "/v1/variants/choose", body: { setId, choice: index }, context, decoder: choiceAnswer }, (reply) => {
    if (reply.ok) answered(entry, index, reply.value);
    else refused(entry, reply.error);
  });
}

function putPictures(entry: VariantEntry): void {
  entry.set.candidates.forEach((candidate) => { if (candidate.picture) entry.pictures[candidate.index] = candidate.picture; });
}

function requestPictures(entry: VariantEntry): void {
  const set = entry.set;
  if (asked.has(set.setId) || entry.closed || set.stale || !set.frame || !uiState().prefs.showThumbnails) return;
  asked.add(set.setId);
  const path = "/v1/variants/" + encodeURIComponent(set.setId) + "/preview";
  const context = transportContext("POST", path, diagnosticId("variants-preview"));
  context.timeoutMs = PREVIEW_TIMEOUT_MS;
  send({ method: "POST", path, body: {}, context, decoder: previewAnswer }, (reply) => {
    if (!reply.ok) return;
    reply.value.forEach(([index, url]) => { entry.pictures[index] = url; });
    touchStatus();
  });
}

function holdOpen(set: VariantSet): void {
  const held = entries.get(set.setId);
  const entry = held ?? { set, selected: firstOffered(set).index, pictures: {}, sending: false, closed: false, note: "", noteTone: "" };
  entry.set = set;
  if (!held) entries.set(set.setId, entry);
  putPictures(entry);
  requestPictures(entry);
}

function reconcile(sets: ReadonlyArray<VariantSet>): void {
  sets.forEach((set) => {
    const entry = entries.get(set.setId);
    if (set.status === "open") holdOpen(set);
    else if (entry && !entry.closed) { entry.closed = true; entry.sending = false; say(entry, closedLine(set), ""); }
  });
  touchStatus();
}

function refreshVariants(): void {
  if (loading) { again = true; return; }
  loading = true;
  const context = transportContext("GET", "/v1/variants", diagnosticId("variants"));
  send({ method: "GET", path: "/v1/variants", body: null, context, decoder: variantSetsAnswer }, (reply) => {
    loading = false;
    if (reply.ok) reconcile(reply.value);
    if (again) { again = false; refreshVariants(); }
  });
}

/** Wires the question. Nothing is requested until the plan list is read and names a set. */
export function wireVariants(): void {
  hooks.refreshVariants = refreshVariants;
  subscribeUi((topic, detail) => {
    if (topic === "change") refreshVariants();
    if (topic === "preview" && detail) { asked.delete(detail); const entry = entries.get(detail); if (entry) requestPictures(entry); }
  });
}

/**
 * Notes history in Settings: pick an effect, see its current and replaced notes, bring a replaced note back, and
 * forget a note, an effect's notes or a plugin's notes (every delete takes two presses). A restore at an effect's
 * limit asks which current note to replace and why. What it says and sends comes from panel-memory.ts; the calls go
 * through panel-memory-net.ts. Nothing here touches a project or a plan. The lists are drawn again when the language changes.
 */
import {
  acknowledged, effectChoices, failureLine, forgetEffectBody, forgetNoteBody, forgetPluginBody, historyAnswer, historySummary, NO_LINE, notesForgottenLine,
  reasonProblem, removedAnswer, replaceCandidates, replacedLine, resolveEffect, restoreBody, suggestEffects, SUGGESTIONS, REASON_MAX,
  type AttemptKey, type EffectChoice, type HistoryView, type Line, type NoteRow, type RestoreSwap
} from "./panel-memory.js";
import { confirmOnSecondPress } from "./panel-memory-confirm.js";
import { callNotes } from "./panel-memory-net.js";
import { onLanguageChange, t } from "./panel-language.js";
import { buttonById, byId, clearChildren, el, inputById, setText } from "./panel-dom.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

interface Replacement { readonly row: NoteRow; readonly view: HistoryView; readonly group: ReadonlyArray<HTMLInputElement>; readonly reason: HTMLInputElement }

let census: () => JsonValue | null = () => null;
let shown: HistoryView | null = null;
let choices: ReadonlyArray<EffectChoice> = [];
let status: Line = NO_LINE;

function say(line: Line): void {
  status = line;
  setText("notes-status", line());
}

function clear(id: string): HTMLElement | null {
  const node = byId(id);
  if (node) clearChildren(node);
  return node;
}

function button(label: string, className: string, onPress: () => void): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onPress);
  return node;
}

function forgetButton(key: string, aria: string, run: () => void): HTMLElement {
  const node = el("button", "danger", t("memory.forget.button"));
  node.type = "button";
  node.setAttribute("aria-label", aria);
  confirmOnSecondPress(node, { key, idle: () => t("memory.forget.button"), armed: () => t("memory.forget.armed"), run });
  return node;
}

function whereOf(row: NoteRow): string {
  const where = row.controlPath ? t("memory.note.control", { path: row.controlPath }) : t("memory.note.whole");
  return row.value ? t("memory.note.withValue", { where, value: row.value }) : where;
}

function noteLine(row: NoteRow): HTMLElement {
  const box = el("div", "memory-note-head");
  box.appendChild(el("span", "memory-note-kind", t(row.kindKey)));
  box.appendChild(el("span", "memory-note-where", whereOf(row)));
  if (row.stale) box.appendChild(el("span", "pill wait", t("memory.note.outOfDate")));
  return box;
}

function noteBlock(row: NoteRow, actions: ReadonlyArray<HTMLElement>): HTMLElement {
  const block = el("div", "memory-note"), bar = el("div", "memory-note-actions");
  block.appendChild(noteLine(row));
  block.appendChild(el("div", "memory-note-text", row.text));
  if (row.stale) block.appendChild(el("div", "memory-note-fine", t(row.stale)));
  if (row.replaced) block.appendChild(el("div", "memory-note-fine", replacedLine(t, row.replaced)));
  actions.forEach((action) => { bar.appendChild(action); });
  block.appendChild(bar);
  return block;
}

function forgetNoteButton(row: NoteRow): HTMLElement {
  return forgetButton("note:" + row.id, t("memory.note.forgetAria"), () => { forgetWith(forgetNoteBody(row.id), "memory.attempt.forgetNote"); });
}

function restoreButton(row: NoteRow, view: HistoryView): HTMLElement {
  const restore = button(t("memory.note.restore"), "", () => { restoreNote(row, view); });
  restore.setAttribute("aria-label", t("memory.note.restoreAria"));
  return restore;
}

function renderLists(list: HTMLElement, view: HistoryView): void {
  if (view.current.length) list.appendChild(el("div", "memory-list-head", t("memory.list.current")));
  view.current.forEach((row) => { list.appendChild(noteBlock(row, [forgetNoteButton(row)])); });
  if (view.replaced.length) list.appendChild(el("div", "memory-list-head", t("memory.list.replaced")));
  view.replaced.forEach((row) => { list.appendChild(noteBlock(row, [restoreButton(row, view), forgetNoteButton(row)])); });
}

function renderForgetAll(view: HistoryView): void {
  const bar = byId("notes-forget-row"), plugin = byId("notes-forget-plugin"), effect = byId("notes-forget-effect");
  const any = view.known && (view.current.length > 0 || view.replaced.length > 0);
  if (bar) bar.hidden = !any;
  if (effect) effect.title = t("memory.forget.effectTitle", { effect: view.effectName });
  if (plugin) { plugin.hidden = !view.pluginKey; plugin.title = view.pluginKey ? t("memory.forget.pluginTitle", { plugin: view.pluginKey }) : ""; }
}

function render(view: HistoryView | null): void {
  shown = view;
  const picker = clear("notes-replace"), list = clear("notes-list"), bar = byId("notes-forget-row");
  if (picker) picker.hidden = true;
  if (!view || !list) { if (bar) bar.hidden = true; return; }
  renderLists(list, view);
  renderForgetAll(view);
  say(() => historySummary(t, view));
}

function fetchHistory(matchName: string, show: (view: HistoryView) => void): void {
  const path = "/v1/notes/history?matchName=" + encodeURIComponent(matchName);
  callNotes({ method: "GET", path, body: null, decoder: historyAnswer(matchName) }, (outcome) => {
    if (outcome.ok) { show(outcome.answer); return; }
    const failure = outcome.failure;
    render(null);
    say(() => failureLine(t, "memory.attempt.loadNotes", failure));
  });
}

function showNotes(matchName: string): void {
  if (!matchName) { say(() => t("memory.history.pickFirst")); return; }
  fetchHistory(matchName, render);
}

function reloadNotes(matchName: string): void {
  fetchHistory(matchName, (view) => {
    const previous = status;
    render(view);
    say(previous);
  });
}

function forgetWith(body: JsonObject, attempt: AttemptKey): void {
  callNotes({ method: "POST", path: "/v1/notes/forget", body, decoder: removedAnswer }, (outcome) => {
    if (!outcome.ok) {
      const failure = outcome.failure;
      say(() => failureLine(t, attempt, failure));
      return;
    }
    const removed = outcome.answer;
    say(() => notesForgottenLine(t, removed));
    if (shown) reloadNotes(shown.matchName);
  });
}

function restoreNote(row: NoteRow, view: HistoryView, swap?: RestoreSwap): void {
  callNotes({ method: "POST", path: "/v1/notes/restore", body: restoreBody(row.id, view.noteIds, swap), decoder: acknowledged }, (outcome) => {
    if (outcome.ok) { say(() => t("memory.restore.done")); reloadNotes(view.matchName); return; }
    if (outcome.failure.code === "EFFECT_NOTES_CAP_REACHED") { askWhichToReplace(row, view); return; }
    const failure = outcome.failure;
    say(() => failureLine(t, "memory.attempt.restore", failure));
    if (failure.code === "EFFECT_NOTES_STALE") reloadNotes(view.matchName);
  });
}

function candidateRow(note: NoteRow, radio: HTMLInputElement): HTMLElement {
  const label = el("label", "memory-candidate");
  radio.type = "radio";
  radio.setAttribute("name", "notes-replace-choice");
  radio.value = note.id;
  label.appendChild(radio);
  label.appendChild(el("span", "", note.text));
  return label;
}

function confirmSwap(replacement: Replacement): void {
  const replaces = replacement.group.find((radio) => radio.checked)?.value || null;
  const reason = replacement.reason.value, problem = reasonProblem(reason);
  if (!replaces) { say(() => t("memory.swap.pickNote")); return; }
  if (problem) { say(() => t(problem)); return; }
  restoreNote(replacement.row, replacement.view, { replaces, reason: reason.trim() });
}

function reasonField(): HTMLInputElement {
  const reason = el("input");
  reason.type = "text";
  reason.id = "notes-replace-reason";
  reason.placeholder = t("memory.reason.placeholder");
  reason.setAttribute("maxlength", String(REASON_MAX));
  reason.setAttribute("aria-label", t("memory.reason.label"));
  return reason;
}

function limitSentence(view: HistoryView): string {
  return view.caps ? t("memory.swap.limit", { limit: t("memory.limit.notes", { count: view.caps.perEffect }) }) : t("memory.swap.limitNoCount");
}

function fillReplacePicker(box: HTMLElement, row: NoteRow, view: HistoryView): void {
  const options = replaceCandidates(row, view.current, view.caps).map((note) => ({ note, radio: el("input") }));
  const reason = reasonField(), bar = el("div", "tools"), group = options.map((option) => option.radio);
  box.hidden = false;
  box.appendChild(el("p", "", limitSentence(view)));
  options.forEach((option) => { box.appendChild(candidateRow(option.note, option.radio)); });
  box.appendChild(reason);
  bar.appendChild(button(t("memory.swap.confirm"), "primary", () => { confirmSwap({ row, view, group, reason }); }));
  bar.appendChild(button(t("memory.swap.cancel"), "", () => { render(shown); }));
  box.appendChild(bar);
}

function askWhichToReplace(row: NoteRow, view: HistoryView): void {
  const box = clear("notes-replace");
  if (!box) return;
  fillReplacePicker(box, row, view);
  say(() => t("memory.swap.limitReached"));
}

function suggestionRow(choice: EffectChoice, input: HTMLInputElement): HTMLElement {
  const row = button(choice.displayName, "ghost memory-suggestion", () => { input.value = choice.displayName; renderSuggestions(); });
  row.title = choice.matchName + (choice.category ? " · " + choice.category : "");
  return row;
}

function renderSuggestions(): void {
  const input = inputById("notes-effect"), box = clear("notes-suggest");
  if (!input || !box) return;
  const typed = input.value, exact = resolveEffect(choices, typed) !== typed.trim();
  const found = exact ? [] : suggestEffects(choices, typed, SUGGESTIONS);
  box.hidden = found.length === 0;
  found.forEach((choice) => { box.appendChild(suggestionRow(choice, input)); });
}

function onShow(): void {
  const input = inputById("notes-effect");
  choices = effectChoices(census());
  if (input) showNotes(resolveEffect(choices, input.value));
}

function wireForgetAll(): void {
  const effect = buttonById("notes-forget-effect"), plugin = buttonById("notes-forget-plugin");
  const attempt: AttemptKey = "memory.attempt.forgetMany";
  if (effect) {
    confirmOnSecondPress(effect, {
      key: "effect", idle: () => t("memory.forget.allEffect"), armed: () => t("memory.forget.allArmed"),
      run: () => { if (shown) forgetWith(forgetEffectBody(shown.matchName), attempt); }
    });
  }
  if (plugin) {
    confirmOnSecondPress(plugin, {
      key: "plugin", idle: () => t("memory.forget.allPlugin"), armed: () => t("memory.forget.allArmed"),
      run: () => { if (shown?.pluginKey) forgetWith(forgetPluginBody(shown.pluginKey), attempt); }
    });
  }
}

function repaintNotes(): void {
  const previous = status;
  if (shown) render(shown);
  say(previous);
}

/** Wires the viewer. `effects` returns the host census (when the panel has one) so an effect can be found by its name. */
export function wireMemoryHistory(effects: () => JsonValue | null): void {
  census = effects;
  const input = inputById("notes-effect"), show = buttonById("notes-show");
  if (input) input.addEventListener("input", () => { choices = effectChoices(census()); renderSuggestions(); });
  if (show) show.addEventListener("click", onShow);
  wireForgetAll();
  onLanguageChange(repaintNotes);
}

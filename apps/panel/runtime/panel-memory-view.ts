/**
 * The Memory section of Settings on screen: the "Learn from my work" switch, "Forget what it learned", and the list of
 * plugins an agent may document. What it says and sends comes from panel-memory.ts; the calls go through
 * panel-memory-net.ts. It loads when the Settings tab opens and after pairing, never on a timer, and it repaints its
 * words when the language changes.
 */
import {
  failureLine, failureSentence, filterPlugins, learnAnswer, learnLine, learnedSentence, learnedWords, memorySettingsAnswer, NO_LINE, NOTHING_LEARNED, optInAnswer,
  optInLine, pluginListNote, PLUGIN_FILTER_FROM, PLUGIN_ROWS, removedAnswer, usageForgottenLine, whyNot, type Line, type LearnedCounts, type MemorySettings, type PluginChoice
} from "./panel-memory.js";
import { confirmOnSecondPress } from "./panel-memory-confirm.js";
import { onSidecarPaired } from "./panel-memory-hooks.js";
import { callNotes } from "./panel-memory-net.js";
import { onLanguageChange, t } from "./panel-language.js";
import { byId, buttonById, clearChildren, el, inputById, setText } from "./panel-dom.js";
import { pageOpen, pageView, onViewShown } from "./panel-page.js";

let plugins: ReadonlyArray<PluginChoice> = [];
let learned: LearnedCounts = NOTHING_LEARNED;
let loading = false;
let status: Line = NO_LINE;

function sayMemory(line: Line): void {
  status = line;
  paintStatus();
}

function paintStatus(): void { setText("memory-status", status()); }

function pluginLabel(plugin: PluginChoice, box: HTMLInputElement): HTMLElement {
  const label = el("label", "memory-plugin");
  label.title = plugin.key;
  label.appendChild(box);
  label.appendChild(el("span", "memory-plugin-name", plugin.key));
  if (plugin.effectCount > 0) label.appendChild(el("span", "memory-plugin-count", String(plugin.effectCount)));
  return label;
}

function withOptIn(key: string, optedIn: boolean): ReadonlyArray<PluginChoice> {
  return plugins.map((plugin) => (plugin.key === key ? { ...plugin, optedIn } : plugin));
}

function setOptIn(plugin: PluginChoice, box: HTMLInputElement): void {
  const want = box.checked;
  box.disabled = true;
  callNotes({ method: "POST", path: "/v1/notes/plugins", body: { pluginKey: plugin.key, enabled: want }, decoder: optInAnswer }, (outcome) => {
    box.disabled = false;
    if (outcome.ok && outcome.answer.enabled === want) {
      plugins = withOptIn(plugin.key, want);
      sayMemory(() => optInLine(t, plugin.key, want));
      return;
    }
    box.checked = !want;
    sayMemory(() => t("memory.attempt.plugin", { plugin: plugin.key, reason: failureSentence(t, whyNot(outcome)) }));
  });
}

function pluginRow(plugin: PluginChoice): HTMLElement {
  const box = el("input");
  box.type = "checkbox";
  box.checked = plugin.optedIn;
  box.setAttribute("aria-label", t("memory.plugin.document", { plugin: plugin.key }));
  box.addEventListener("change", () => { setOptIn(plugin, box); });
  return pluginLabel(plugin, box);
}

function renderPlugins(): void {
  const list = byId("memory-plugins"), filter = inputById("memory-plugin-filter");
  if (!list) return;
  const query = filter && filter.value ? filter.value : "", view = filterPlugins(plugins, query, PLUGIN_ROWS);
  clearChildren(list);
  view.rows.forEach((plugin) => { list.appendChild(pluginRow(plugin)); });
  if (filter) filter.hidden = plugins.length <= PLUGIN_FILTER_FROM;
  setText("memory-plugins-note", pluginListNote(t, { total: plugins.length, shown: view.rows.length, matched: view.matched, query }));
}

function paintLearned(): void { setText("memory-learned", learnedSentence(t, learnedWords(t, learned))); }

function paintMemoryState(): void {
  const box = inputById("learn-from-work");
  const state = t(box && !box.checked ? "memory.state.off" : "memory.state.on");
  const words = learnedWords(t, learned);
  setText("memory-state", words ? t("memory.state.withLearned", { state, learned: words }) : state);
}

function sayLearned(counts: LearnedCounts): void {
  learned = counts;
  paintLearned();
  paintMemoryState();
}

function showSettings(settings: MemorySettings): void {
  const box = inputById("learn-from-work");
  if (box) { box.checked = settings.learnFromWork; box.disabled = false; }
  sayLearned(settings.learned);
  plugins = settings.plugins;
  renderPlugins();
}

function refreshMemory(): void {
  if (loading) return;
  loading = true;
  callNotes({ method: "GET", path: "/v1/notes/settings", body: null, decoder: memorySettingsAnswer }, (outcome) => {
    loading = false;
    if (outcome.ok) { showSettings(outcome.answer); sayMemory(NO_LINE); return; }
    const failure = outcome.failure;
    sayMemory(() => failureLine(t, "memory.attempt.load", failure));
  });
}

function refreshIfShown(): void {
  if (pageOpen() && pageView() === "settings") refreshMemory();
}

function onLearnChange(box: HTMLInputElement): void {
  const want = box.checked;
  box.disabled = true;
  callNotes({ method: "POST", path: "/v1/notes/learn-from-work", body: { enabled: want }, decoder: learnAnswer }, (outcome) => {
    box.disabled = false;
    if (outcome.ok) {
      const enabled = outcome.answer.learnFromWork;
      box.checked = enabled;
      paintMemoryState();
      sayMemory(() => learnLine(t, enabled));
      return;
    }
    box.checked = !want;
    sayMemory(() => failureLine(t, "memory.attempt.learn", whyNot(outcome)));
  });
}

function forgetUsage(button: HTMLButtonElement): void {
  button.disabled = true;
  callNotes({ method: "POST", path: "/v1/notes/usage/forget", body: {}, decoder: removedAnswer }, (outcome) => {
    button.disabled = false;
    if (!outcome.ok) {
      sayMemory(() => failureLine(t, "memory.attempt.forgetUsage", whyNot(outcome)));
      return;
    }
    const removed = outcome.answer;
    sayLearned(NOTHING_LEARNED);
    sayMemory(() => usageForgottenLine(t, removed));
  });
}

function repaintMemory(): void {
  paintLearned();
  paintMemoryState();
  renderPlugins();
  paintStatus();
}

/** Wires the section's controls. Nothing is requested until the Settings tab is shown or the panel has paired. */
export function wireMemory(): void {
  const learn = inputById("learn-from-work"), forget = buttonById("memory-forget"), filter = inputById("memory-plugin-filter");
  if (learn) learn.addEventListener("change", () => { onLearnChange(learn); });
  if (forget) {
    confirmOnSecondPress(forget, { key: "usage", idle: () => t("memory.usage.forget"), armed: () => t("memory.forget.armed"), run: () => { forgetUsage(forget); } });
  }
  if (filter) filter.addEventListener("input", renderPlugins);
  onViewShown("settings", refreshMemory);
  onSidecarPaired(refreshIfShown);
  onLanguageChange(repaintMemory);
}

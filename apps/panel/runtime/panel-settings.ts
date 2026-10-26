/** Settings: Approvals (prefs saved in the sidecar), the Preferences switches, the model buttons, Connect an agent, and the accordion's one-line summaries. */
import { wireDecisionSection } from "./panel-decision.js";
import { byId, el, inputById, setText, textareaById } from "./panel-dom.js";
import { wireModelButtons } from "./panel-model-save.js";
import { copyText } from "./panel-plan-actions.js";
import { setDeveloper, wireAccordion } from "./panel-page.js";
import { onLanguageChange, t } from "./panel-language.js";
import { later } from "./panel-transport.js";
import { setPref } from "./panel-prefs.js";
import type { UiPrefs } from "./ui-contract.js";
import { type JsonObject } from "@extynt/decode";
import { subscribeUi, uiState } from "./ui-state.js";

const ASK_CHOICES = [
  { id: "risky", labelKey: "settings.approvals.risky.label", summaryKey: "settings.approvals.risky.summary", noteKey: "settings.approvals.risky.note", tagKey: "settings.approvals.recommended" },
  { id: "always", labelKey: "settings.approvals.always.label", summaryKey: "settings.approvals.always.summary", noteKey: "settings.approvals.always.note", tagKey: null },
  { id: "never", labelKey: "settings.approvals.never.label", summaryKey: "settings.approvals.never.summary", noteKey: "settings.approvals.never.note", tagKey: null },
] as const;

type AskChoice = (typeof ASK_CHOICES)[number];

interface Switch {
  readonly id: string;
  readonly isOn: (prefs: UiPrefs) => boolean;
  readonly patch: (on: boolean) => Partial<UiPrefs>;
}

interface AskRow {
  readonly choice: AskChoice;
  readonly row: HTMLLabelElement;
  readonly radio: HTMLInputElement;
  readonly title: HTMLElement;
  readonly note: HTMLElement;
}

interface AgentConnection {
  readonly copyKeys: string;
  readonly config: JsonObject;
  readonly configNoteKey: "settings.agents.macConfigNote" | "settings.agents.windowsConfigNote";
  readonly prompt: string;
}

interface SetupServer {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly homeStep: string;
}

const SWITCHES: ReadonlyArray<Switch> = [
  { id: "suggest-prompts", isOn: (prefs) => prefs.suggestPrompts, patch: (on) => ({ suggestPrompts: on }) },
  { id: "show-thumbnails", isOn: (prefs) => prefs.showThumbnails, patch: (on) => ({ showThumbnails: on }) },
  { id: "rate-limit-enabled", isOn: (prefs) => prefs.rateLimit, patch: (on) => ({ rateLimit: on }) },
  { id: "developer-page", isOn: (prefs) => prefs.diagnostics, patch: (on) => ({ diagnostics: on }) },
];

const COPIED_RESET_MS = 2500;

function onPrefsChange(paint: () => void): void {
  subscribeUi((topic) => {
    if (topic === "prefs") paint();
  });
}

function bindSwitch(entry: Switch): void {
  const box = inputById(entry.id);
  if (!box) return;
  box.checked = entry.isOn(uiState().prefs);
  box.addEventListener("change", () => setPref(entry.patch(box.checked)));
  onPrefsChange(() => {
    box.checked = entry.isOn(uiState().prefs);
  });
}

function askRow(choice: AskChoice): AskRow {
  const row = el("label", "ask-choice");
  const radio = el("input");
  radio.type = "radio";
  radio.setAttribute("name", "ask-before-applying");
  radio.value = choice.id;
  radio.addEventListener("change", () => {
    if (radio.checked) setPref({ askBeforeApplying: choice.id });
  });
  const title = el("span", "ask-title");
  const text = el("span", "ask-text");
  const note = el("span", "ask-note");
  text.appendChild(title);
  text.appendChild(note);
  row.appendChild(radio);
  row.appendChild(text);
  return { choice, row, radio, title, note };
}

function paintAskRow(entry: AskRow, current: UiPrefs["askBeforeApplying"]): void {
  const on = entry.choice.id === current;
  entry.radio.checked = on;
  entry.row.className = on ? "ask-choice on" : "ask-choice";
  entry.title.textContent = t(entry.choice.labelKey);
  if (entry.choice.tagKey) entry.title.appendChild(el("span", "ask-tag", t(entry.choice.tagKey)));
  entry.note.textContent = t(entry.choice.noteKey);
}

function paintAsk(rows: ReadonlyArray<AskRow>): void {
  const current = uiState().prefs.askBeforeApplying;
  rows.forEach((entry) => paintAskRow(entry, current));
  const chosen = ASK_CHOICES.find((choice) => choice.id === current);
  setText("approvals-state", chosen ? t(chosen.summaryKey) : "");
}

function mountAskList(): void {
  const list = byId("ask-list");
  if (!list) return;
  const rows = ASK_CHOICES.map(askRow);
  for (const entry of rows) list.appendChild(entry.row);
  onPrefsChange(() => paintAsk(rows));
  onLanguageChange(() => paintAsk(rows));
  paintAsk(rows);
}

function paintFramesState(): void {
  const prefs = uiState().prefs;
  const off = [prefs.showThumbnails, prefs.suggestPrompts, prefs.rateLimit].filter((on) => !on).length;
  setText("frames-state", off === 0 ? t("settings.frames.allOn") : t("settings.frames.off", { count: off }));
}

function setupPrompt(server: SetupServer): string {
  return [
    "Set up extynt as an MCP server for me.",
    "",
    "Server name: extynt",
    "Transport: stdio",
    "Command: " + server.command,
    "Arguments: " + JSON.stringify(server.args),
    "",
    "Steps:",
    "1. " + server.homeStep,
    "2. Add this server to your MCP configuration, using the mcpServers format if your agent supports it. If you cannot edit that configuration yourself, tell me the exact steps for this agent and stop there.",
    "3. Restart or reload so the server starts.",
    "4. Check that the server is connected and that a tool named ae_status is listed.",
    "5. Tell me whether it worked, and if not, what failed. Change nothing else.",
  ].join("\n");
}

const MAC_CONNECTION: AgentConnection = {
  copyKeys: "⌘C",
  config: { mcpServers: { extynt: { command: "sh", args: ["/Users/YOU/Library/Application Support/extynt/bin/extynt-mcp"] } } },
  configNoteKey: "settings.agents.macConfigNote",
  prompt: setupPrompt({
    command: "sh",
    args: ["~/Library/Application Support/extynt/bin/extynt-mcp"],
    homeStep: "Replace ~ with the full path of my home folder, because configuration files do not expand it.",
  }),
};

const WINDOWS_CONNECTION: AgentConnection = {
  copyKeys: "Ctrl+C",
  config: { mcpServers: { extynt: { command: "cmd", args: ["/c", "%ProgramData%\\extynt\\bin\\extynt-mcp.cmd"] } } },
  configNoteKey: "settings.agents.windowsConfigNote",
  prompt: setupPrompt({
    command: "cmd",
    args: ["/c", "%ProgramData%\\extynt\\bin\\extynt-mcp.cmd"],
    homeStep: "Use the command and arguments exactly as written; cmd expands %ProgramData% itself.",
  }),
};

function agentConnection(): AgentConnection {
  return uiState().native?.platform === "windows" ? WINDOWS_CONNECTION : MAC_CONNECTION;
}

function paintCopyLabel(copy: HTMLElement, key: "settings.agents.copyPrompt" | "settings.agents.copied"): void {
  copy.setAttribute("data-i18n", key);
  copy.textContent = t(key);
}

function wireCopyPrompt(copy: HTMLElement, prompt: HTMLTextAreaElement): void {
  copy.addEventListener("click", () => {
    const copied = copyText(prompt.value);
    if (copied) {
      paintCopyLabel(copy, "settings.agents.copied");
    } else {
      copy.textContent = t("settings.agents.copyHint", { keys: agentConnection().copyKeys });
      prompt.focus();
      prompt.select();
    }
    later(() => paintCopyLabel(copy, "settings.agents.copyPrompt"), COPIED_RESET_MS);
  });
}

function configText(connection: AgentConnection): string {
  return JSON.stringify(connection.config, null, 2) + "\n\n" + t(connection.configNoteKey);
}

function paintConfigToggle(toggle: HTMLElement, hidden: boolean): void {
  const key = hidden ? "settings.agents.showConfig" : "settings.agents.hideConfig";
  toggle.setAttribute("data-i18n", key);
  toggle.textContent = t(key);
}

function wireConfigToggle(toggle: HTMLElement, block: HTMLElement): void {
  const paintBlock = (): void => {
    if (!block.hidden) block.textContent = configText(agentConnection());
  };
  toggle.addEventListener("click", () => {
    block.hidden = !block.hidden;
    paintConfigToggle(toggle, block.hidden);
    block.textContent = configText(agentConnection());
  });
  onLanguageChange(paintBlock);
}

function wireAgentBlock(): void {
  const prompt = textareaById("mcp-prompt");
  const copy = byId("mcp-copy-prompt");
  const toggle = byId("mcp-json");
  const block = byId("mcp-json-block");
  if (prompt) prompt.value = agentConnection().prompt;
  if (copy && prompt) wireCopyPrompt(copy, prompt);
  if (toggle && block) wireConfigToggle(toggle, block);
}

function paintDeveloper(): void {
  setDeveloper(uiState().prefs.diagnostics);
}

/** Wires every control on the Settings page: the approval choice, the switches, the model buttons, the agent block and the accordion. */
export function wireSettings(): void {
  mountAskList();
  SWITCHES.forEach(bindSwitch);
  paintDeveloper();
  onPrefsChange(paintDeveloper);
  paintFramesState();
  onPrefsChange(paintFramesState);
  onLanguageChange(paintFramesState);
  wireModelButtons();
  wireDecisionSection();
  wireAgentBlock();
  wireAccordion();
}

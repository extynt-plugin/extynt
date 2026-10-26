/** The Decision model section of Settings: choose a provider, paste a key, Save, Test or Remove. It reads the sidecar's secret-free state and never keeps a key after it is sent. */
import { buttonById, byId, clearChildren, detailsOf, el, inputById, selectById } from "./panel-dom.js";
import { onLanguageChange, t } from "./panel-language.js";
import { providerAsksFor, type DecisionField } from "@extynt/ui-text";
import { decisionReplyDecoder, type DecisionReplyView, type DecisionStateView } from "./panel-decision-wire.js";
import { ADVANCED_FIELDS, advancedOpens, headlineModel, PANEL_PROVIDERS, PROVIDER_KEYS, receiptLine, testLine } from "./panel-decision-view.js";
import { openRowInSettings } from "./panel-page.js";
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import { subscribeUi } from "./ui-state.js";

const PATH = "/v1/settings/decision";
const TEST_TIMEOUT_MS = 60000;

type DecisionBody = {
  readonly provider?: string;
  readonly action?: "clear";
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly accountId?: string;
  readonly test?: true;
};

let current: DecisionStateView | null = null;
let failedSave = false;
let lines: ReadonlyArray<{ readonly ok: boolean; readonly text: string }> = [];
let shadows: readonly string[] = [];

function paintProviders(): void {
  const select = selectById("decision-provider");
  if (!select) return;
  const chosen = select.value || headlineModel(current ?? { configured: false, models: [], skipped: [], listProblem: "" })?.provider || "jev";
  clearChildren(select);
  for (const provider of PANEL_PROVIDERS) {
    const option = el("option", "", t(PROVIDER_KEYS[provider]));
    option.value = provider;
    select.appendChild(option);
  }
  select.value = chosen;
}

function paintStatus(): void {
  const box = byId("decision-status");
  if (!box || !current) return;
  clearChildren(box);
  const receipt = receiptLine(current, lines, t, chosenProvider());
  box.appendChild(el("div", "decision-line " + receipt.tone, receipt.text));
  for (const text of shadows) box.appendChild(el("div", "decision-line warn", text));
}

function paintSaveLabel(): void {
  const button = buttonById("decision-save");
  if (button) button.textContent = t(failedSave ? "settings.decision.page.retry" : "settings.model.save");
}

function paintKeyHint(): void {
  const key = inputById("decision-key");
  const provider = selectById("decision-provider")?.value;
  if (!key || !current) return;
  const saved = current.models.some((model) => model.provider === provider && model.keySet);
  const remove = buttonById("decision-remove");
  if (remove) remove.hidden = !saved;
  key.placeholder = saved ? t("settings.decision.keySaved") : "";
}

function typedFields(): Readonly<Record<DecisionField, string>> {
  const text = (id: string): string => inputById(id)?.value.trim() ?? "";
  return { model: text("decision-model"), baseUrl: text("decision-base-url"), accountId: text("decision-account-id") };
}

function paintFields(): void {
  const provider = chosenProvider();
  for (const { row, field } of ADVANCED_FIELDS) {
    const box = byId(row);
    if (box) box.hidden = !providerAsksFor(provider, field);
  }
  const details = detailsOf("decision-advanced");
  if (details && advancedOpens(provider, typedFields(), failedSave)) details.open = true;
}

function onProviderChange(): void {
  lines = [];
  paintStatus();
  paintFields();
  paintKeyHint();
}

function paint(): void {
  paintProviders();
  paintFields();
  paintStatus();
  paintKeyHint();
  paintSaveLabel();
}

function chosenProvider(): (typeof PANEL_PROVIDERS)[number] {
  const value = selectById("decision-provider")?.value;
  return PANEL_PROVIDERS.find((provider) => provider === value) ?? "jev";
}

function clearKey(): void {
  const key = inputById("decision-key");
  if (key) key.value = "";
}

function apply(reply: DecisionReplyView): void {
  if (reply.state) current = reply.state;
  shadows = reply.shadowed.map((item) => t("settings.decision.shadowed", { variable: item.variable, source: item.source }));
  const provider = reply.test?.provider ?? chosenProvider();
  const test = reply.test ? [testLine(reply.test, provider, t)] : [];
  if (reply.saved !== undefined) failedSave = !reply.saved;
  if (reply.saved === true) clearKey();
  lines = test;
  paint();
}

function request(call: { readonly method: string; readonly path: string; readonly body: DecisionBody | null; readonly busy: string }): void {
  if (call.busy !== "") {
    lines = [{ ok: true, text: call.busy }];
    paint();
  }
  const context = { ...transportContext(call.method, call.path, diagnosticId("decision")), timeoutMs: TEST_TIMEOUT_MS };
  send({ method: call.method, path: call.path, body: call.body, context, decoder: decisionReplyDecoder }, (reply) => {
    if (reply.ok) apply(reply.value);
    else {
      lines = [{ ok: false, text: reply.error.reason }];
      paint();
    }
  });
}

function typed(): DecisionBody {
  const provider = chosenProvider();
  const shown = ADVANCED_FIELDS.filter(({ field }) => providerAsksFor(provider, field));
  const fields = shown.flatMap(({ input, field }) => {
    const text = inputById(input)?.value.trim() ?? "";
    return text === "" ? [] : [[field, text] as const];
  });
  const key = inputById("decision-key")?.value.trim() ?? "";
  return { provider, ...(key === "" ? {} : { apiKey: key }), ...Object.fromEntries(fields), test: true };
}

function save(): void {
  request({ method: "POST", path: PATH, body: typed(), busy: t("settings.decision.status.testing") });
}

function remove(): void {
  const provider = selectById("decision-provider")?.value ?? "jev";
  request({ method: "POST", path: PATH, body: { provider, action: "clear" }, busy: t("settings.decision.status.removed") });
}

function test(): void {
  const provider = selectById("decision-provider")?.value;
  request({ method: "POST", path: PATH + "/test", body: provider ? { provider } : null, busy: t("settings.decision.status.testing") });
}

function refresh(): void {
  request({ method: "GET", path: PATH, body: null, busy: "" });
}

function reveal(): void {
  openRowInSettings("decision");
  inputById("decision-key")?.focus();
}

/** Wires the section: its buttons, a repaint on language change, and a refresh when the sidecar says the settings changed or asks the panel to open the section. */
export function wireDecisionSection(): void {
  buttonById("decision-save")?.addEventListener("click", save);
  buttonById("decision-test")?.addEventListener("click", test);
  buttonById("decision-remove")?.addEventListener("click", remove);
  selectById("decision-provider")?.addEventListener("change", onProviderChange);
  onLanguageChange(paint);
  subscribeUi((topic, detail) => {
    if (topic !== "decision") return;
    refresh();
    if (detail === "open") reveal();
  });
  refresh();
}

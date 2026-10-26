/**
 * The first-run card in the empty chat: two steps, connect a model and try a prompt. The first step is a small form that
 * saves the chosen service and tests it; it asks only for the fields that service needs.
 */
import { el } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { chipRow } from "./panel-prompt-chips.js";
import { loadModelSettings } from "./panel-model-apply.js";
import { getModelSettings } from "./panel-model-store.js";
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import { createTrainingNotice, type TrainingNotice, type TrainingSubject } from "./panel-training-notice.js";
import { uiState } from "./ui-state.js";
import { fallback, type JsonObject, literal, map, object, string } from "@extynt/decode";

type Service = TrainingSubject & {
  readonly label: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly keyRequired: boolean;
};

type Status = () => string;

type ProblemKey = "model.setup.tickFirst" | "model.setup.typeAddress" | "model.setup.typeModel" | "model.setup.pasteKeyFirst";

interface Draft {
  chosen: string | null;
  key: string;
  address: string;
  model: string;
  status: Status;
  busy: boolean;
  trainingAccepted: boolean;
  notice: TrainingNotice | null;
  card: HTMLElement | null;
}

const TEST_TIMEOUT_MS = 120000;
const MODEL_PLACEHOLDERS: ReadonlyMap<string, string> = new Map([
  ["ollama", "llama3.1"],
  ["xai", "grok-4"],
  ["openrouter", "anthropic/claude-sonnet-5"],
]);

const draft: Draft = { chosen: null, key: "", address: "", model: "", status: () => t("model.setup.notTested"), busy: false, trainingAccepted: false, notice: null, card: null };

const testDecoder = fallback(object({ ok: fallback(literal(true), false), provider: fallback(string(), ""), model: fallback(string(), ""), error: fallback(object({ message: fallback(string(), "") }), null) }), null);
const savedDecoder = map(fallback(object({ ok: fallback(literal(true), false) }), null), (saved) => saved?.ok === true);

function services(): ReadonlyArray<Service> {
  return (getModelSettings()?.services ?? []).map((entry) => ({ ...entry, label: entry.label || entry.id }));
}

function clearDraft(): void {
  draft.key = "";
  draft.address = "";
  draft.model = "";
  draft.trainingAccepted = false;
}

function providerButton(entry: Service, redraw: () => void): HTMLElement {
  const button = el("button", "setup-provider");
  button.type = "button";
  button.setAttribute("aria-pressed", draft.chosen === entry.id ? "true" : "false");
  button.appendChild(el("span", "", entry.label));
  button.addEventListener("click", () => {
    draft.chosen = entry.id;
    draft.address = "";
    draft.model = "";
    draft.trainingAccepted = false;
    redraw();
  });
  return button;
}

function answerStatus(message: string | undefined): Status {
  return message ? () => message : () => t("model.status.noAnswer");
}

function testPrimary(redraw: () => void): void {
  const path = "/v1/settings/model/test";
  const context = transportContext("POST", path, diagnosticId("model-test"));
  context.timeoutMs = TEST_TIMEOUT_MS;
  send({ method: "POST", path, body: { slot: "primary" }, context, decoder: testDecoder }, (reply) => {
    draft.busy = false;
    if (!reply.ok) draft.status = () => reply.error.reason;
    else if (reply.value?.ok !== true) draft.status = answerStatus(reply.value?.error?.message);
    else {
      const { provider, model } = reply.value;
      draft.status = () => t("model.status.answered", { provider, model });
      clearDraft();
      loadModelSettings();
    }
    redraw();
  });
}

function saveBody(entry: Service): JsonObject {
  const primary: Record<string, string | boolean> = { service: entry.id, model: entry.model || draft.model.trim() };
  if (draft.key) primary.apiKey = draft.key;
  if (draft.notice?.acknowledgement() === true) primary.acknowledgeTrainingRisk = true;
  if (entry.addressEditable) primary.baseUrl = (draft.address || entry.baseUrl).trim();
  return { primary };
}

function saveAndTest(entry: Service, redraw: () => void): void {
  draft.busy = true;
  draft.status = () => t("model.status.saving");
  redraw();
  const path = "/v1/settings/model";
  const context = transportContext("POST", path, diagnosticId("model-save"));
  send({ method: "POST", path, body: saveBody(entry), context, decoder: savedDecoder }, (reply) => {
    if (!reply.ok || !reply.value) {
      draft.busy = false;
      const reason = reply.ok ? "" : reply.error.reason;
      draft.status = reply.ok ? () => t("model.status.saveFailed") : () => reason;
      redraw();
      return;
    }
    draft.status = () => t("model.status.testing");
    redraw();
    testPrimary(redraw);
  });
}

function trainingProblem(): ProblemKey | undefined {
  if (!draft.notice) return undefined;
  draft.trainingAccepted = draft.notice.acknowledgement() === true;
  return draft.notice.blocking() ? "model.setup.tickFirst" : undefined;
}

function setupProblem(entry: Service): ProblemKey | undefined {
  if (entry.addressEditable && !(draft.address || entry.baseUrl).trim()) return "model.setup.typeAddress";
  if (!entry.model && !draft.model.trim()) return "model.setup.typeModel";
  if (entry.keyRequired && !draft.key) return "model.setup.pasteKeyFirst";
  return trainingProblem();
}

function submitSetup(list: ReadonlyArray<Service>, redraw: () => void): void {
  const entry = list.find((item) => item.id === draft.chosen);
  if (draft.busy || !entry) return;
  const problem = setupProblem(entry);
  if (problem) {
    draft.status = () => t(problem);
    redraw();
    return;
  }
  saveAndTest(entry, redraw);
}

function step(number: number, title: string, state: "done" | "on" | "off", body: ReadonlyArray<HTMLElement>): HTMLElement {
  const box = el("div", "setup-step" + (state === "off" ? "" : " " + state));
  const head = el("div", "setup-step-head");
  head.appendChild(el("span", "setup-num", state === "done" ? "✓" : String(number)));
  head.appendChild(el("span", "setup-step-title", title));
  box.appendChild(head);
  body.forEach((node) => box.appendChild(node));
  return box;
}

function setupField(labelText: string, id: string, input: HTMLInputElement): HTMLElement {
  const field = el("div", "field");
  const label = el("label", "", labelText);
  input.type = "text";
  input.id = id;
  label.setAttribute("for", id);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  field.appendChild(label);
  field.appendChild(input);
  return field;
}

function addressFields(entry: Service): HTMLElement[] {
  const input = el("input");
  input.value = draft.address || entry.baseUrl;
  input.placeholder = entry.baseUrl || "https://…/v1";
  input.addEventListener("input", () => {
    draft.address = input.value;
    draft.notice?.update(entry, input.value, draft.notice.acknowledgement() === true);
  });
  const fields = [setupField(t("model.field.address"), "setup-address", input)];
  if (entry.id === "ollama") fields.push(el("div", "muted", t("model.setup.ollamaPort")));
  return fields;
}

function modelField(entry: Service): HTMLElement {
  const input = el("input");
  input.value = draft.model;
  input.placeholder = MODEL_PLACEHOLDERS.get(entry.id) ?? "model-id";
  input.addEventListener("input", () => {
    draft.model = input.value;
  });
  return setupField(t("model.setup.modelName"), "setup-model", input);
}

function keyField(entry: Service): HTMLElement {
  const input = el("input");
  input.value = draft.key;
  input.addEventListener("input", () => {
    draft.key = input.value;
  });
  const field = setupField(entry.keyRequired ? t("model.setup.pasteKey") : t("model.setup.keyOptional"), "setup-key", input);
  input.type = "password";
  return field;
}

function setupFields(entry: Service): HTMLElement[] {
  const fields: HTMLElement[] = [];
  if (entry.addressEditable) fields.push(...addressFields(entry));
  if (!entry.model) fields.push(modelField(entry));
  if (entry.keyRequired || !entry.baseUrl || entry.addressEditable) fields.push(keyField(entry));
  draft.notice = createTrainingNotice();
  draft.notice.update(entry, draft.address || entry.baseUrl, draft.trainingAccepted);
  fields.push(draft.notice.node);
  return fields;
}

function redrawCard(): void {
  const current = draft.card;
  const parent = current ? current.parentNode : null;
  if (!current || !parent) return;
  const next = firstRunCard();
  parent.insertBefore(next, current);
  parent.removeChild(current);
  const input = next.querySelector("input");
  if (input && draft.key) input.focus();
}

function modelStep(): HTMLElement[] {
  const list = services();
  const first = list[0];
  if (!draft.chosen && first) draft.chosen = first.id;
  const providers = el("div", "setup-providers");
  list.forEach((entry) => providers.appendChild(providerButton(entry, redrawCard)));
  const current = list.find((entry) => entry.id === draft.chosen);
  const fields: HTMLElement[] = [providers];
  if (current) fields.push(...setupFields(current));
  const save = el("button", "primary", t("model.setup.saveAndTest"));
  save.type = "button";
  save.disabled = draft.busy;
  save.addEventListener("click", () => submitSetup(list, redrawCard));
  return [...fields, el("div", "setup-status muted", draft.status()), save, el("div", "setup-foot", t("model.setup.footer"))];
}

/** The first-run card: connect a model, try a prompt. */
export function firstRunCard(): HTMLElement {
  const card = el("div", "setup-card first-run");
  draft.card = card;
  const modelDone = uiState().modelConfigured !== false;
  card.appendChild(el("h2", "", t("model.setup.heading")));
  card.appendChild(el("p", "", t("model.setup.intro")));
  card.appendChild(step(1, t("model.setup.connect"), modelDone ? "done" : "on", modelDone ? [] : modelStep()));
  card.appendChild(step(2, t("model.setup.tryPrompt"), modelDone ? "on" : "off", [chipRow(uiState().focus, modelDone)]));
  return card;
}

/** Builds the first-run card again in the current language, when it is on screen; the typed fields are kept. */
export function repaintFirstRun(): void {
  if (draft.card?.parentNode) redrawCard();
}

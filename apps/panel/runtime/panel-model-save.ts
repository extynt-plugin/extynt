/** The Save and Test buttons under the provider forms: saving both slots, then asking each configured model to answer once. */
import { buttonById } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { t } from "./panel-language.js";
import { showModelSettings } from "./panel-model-apply.js";
import type { SlotName } from "./panel-model-form-controls.js";
import { slotUpdate, trainingBlocked } from "./panel-model-form.js";
import { getModelSettings, setModelSettings } from "./panel-model-store.js";
import { modelStatus, modelStatusRows } from "./panel-model-summary.js";
import type { StatusLine } from "./panel-model-summary.js";
import { modelChangeDecoder, modelTestDecoder } from "./panel-model-wire.js";
import type { ModelTest } from "./panel-model-wire.js";
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import type { Reply } from "./panel-transport.js";

const SETTINGS_PATH = "/v1/settings/model";
const TEST_PATH = "/v1/settings/model/test";
const TEST_TIMEOUT_MS = 120000;

function answerLine(test: ModelTest): StatusLine {
  if (test.ok) return { ok: true, text: t("model.test.answeredIn", { provider: test.provider, model: test.model, seconds: (test.ms / 1000).toFixed(1) }) };
  return { ok: false, text: test.error?.message || t("model.status.noAnswer") };
}

function testLine(slot: SlotName, reply: Reply<ModelTest>): StatusLine {
  const line = reply.ok ? answerLine(reply.value) : { ok: false, text: reply.error.reason };
  if (slot === "primary") return line;
  return { ok: line.ok, text: t("model.test.fallbackLine", { line: line.text }) };
}

function testSlot(slot: SlotName, done: (line: StatusLine) => void): void {
  const context = { ...transportContext("POST", TEST_PATH, diagnosticId("model-test")), timeoutMs: TEST_TIMEOUT_MS };
  send({ method: "POST", path: TEST_PATH, body: { slot }, context, decoder: modelTestDecoder }, (reply) => done(testLine(slot, reply)));
}

function testSlots(remaining: ReadonlyArray<SlotName>, lines: ReadonlyArray<StatusLine>, finish: (lines: ReadonlyArray<StatusLine>) => void): void {
  const [slot, ...rest] = remaining;
  if (slot === undefined) {
    finish(lines);
    return;
  }
  testSlot(slot, (line) => testSlots(rest, [...lines, line], finish));
}

function testModel(button: HTMLButtonElement): void {
  const slots: ReadonlyArray<SlotName> = getModelSettings()?.active.fallback ? ["primary", "fallback"] : ["primary"];
  button.disabled = true;
  modelStatus(t("model.status.testing"));
  testSlots(slots, [], (lines) => {
    button.disabled = false;
    modelStatusRows(lines);
  });
}

function saveModel(save: HTMLButtonElement, test: HTMLButtonElement): void {
  if (trainingBlocked()) {
    modelStatus(t("model.status.trainingBlocked"), "bad");
    return;
  }
  save.disabled = true;
  modelStatus(t("model.status.saving"));
  const body = { primary: slotUpdate("primary"), fallback: slotUpdate("fallback") };
  const context = transportContext("POST", SETTINGS_PATH, diagnosticId("model-save"));
  send({ method: "POST", path: SETTINGS_PATH, body, context, decoder: modelChangeDecoder }, (reply) => {
    save.disabled = false;
    if (!reply.ok) {
      modelStatus(reply.error.reason, "bad");
    } else if (!reply.value.ok) {
      modelStatus(t("model.status.saveFailed"), "bad");
    } else {
      setModelSettings(reply.value);
      showModelSettings(reply.value);
      hooks.renderTranscript();
      testModel(test);
    }
  });
}

/** Makes Save store both providers and then test them, and Test ask each configured model to answer once. */
export function wireModelButtons(): void {
  const save = buttonById("model-save");
  const test = buttonById("model-test");
  if (!save || !test) return;
  save.addEventListener("click", () => saveModel(save, test));
  test.addEventListener("click", () => testModel(test));
}

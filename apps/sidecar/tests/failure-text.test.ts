/** Failure and refusal text in all six languages: the real composing functions and routes, rendered through each language's translator. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeOrThrow, jsonValue, type JsonValue } from "@extynt/decode";
import { translatorFor, type Language } from "@extynt/ui-text";
import { providerFailure } from "../src/agent-failure.js";
import { cancelledFailure, contextLimitFailure, planRejectedFailure, stepLimitFailure } from "../src/agent-failure-text.js";
import { applySlotUpdates } from "../src/llm-slot-updates.js";
import { TrainingRiskRefusal } from "../src/training-policy.js";
import { fieldOf } from "./http-json.js";
import { authorization } from "./sidecar-fixture.js";
import { startUiSidecar } from "./ui-fixture.js";

const LANGUAGES: readonly Language[] = ["en", "es", "de", "fr", "ja", "zh-Hans"];
const provider = { displayName: "OpenAI", keyVariable: "OPENAI_API_KEY" };

const TIMEOUT: Record<Language, string> = {
  en: "OpenAI took too long to respond.",
  es: "OpenAI tardó demasiado en responder.",
  de: "OpenAI hat zu lange für die Antwort gebraucht.",
  fr: "OpenAI a mis trop de temps à répondre.",
  ja: "OpenAIの応答に時間がかかりすぎました。",
  "zh-Hans": "OpenAI响应超时。",
};

const AUTH: Record<Language, string> = {
  en: "OpenAI rejected the API key (HTTP 401). Check the API key under Diagnostics → Model, then press Test (it is saved as OPENAI_API_KEY).",
  es: "OpenAI rechazó la clave de API (HTTP 401). Revisa la clave en Diagnóstico → Modelo y pulsa Probar (se guarda como OPENAI_API_KEY).",
  de: "OpenAI hat den API-Schlüssel abgelehnt (HTTP 401). Prüfe den Schlüssel unter Diagnose → Modell und tippe auf Testen (gespeichert als OPENAI_API_KEY).",
  fr: "OpenAI a refusé la clé API (HTTP 401). Vérifiez la clé sous Diagnostics → Modèle, puis appuyez sur Tester (elle est enregistrée sous OPENAI_API_KEY).",
  ja: "OpenAIがAPIキーを拒否しました（HTTP 401）。「診断」→「モデル」でAPIキーを確認し、「テスト」を押してください（OPENAI_API_KEYとして保存されています）。",
  "zh-Hans": "OpenAI拒绝了 API 密钥（HTTP 401）。请在“诊断 → 模型”中检查 API 密钥，然后点击“测试”（密钥保存为 OPENAI_API_KEY）。",
};

test("a provider that timed out, rejected the key or is rate limiting is described in each language", () => {
  for (const language of LANGUAGES) {
    const t = translatorFor(language);
    assert.equal(providerFailure({ status: 401 }, provider, t).message, AUTH[language]);
    assert.match(providerFailure({ status: 429 }, provider, t).message, /OpenAI/);
    assert.match(providerFailure({ status: 503 }, provider, t).message, /503/);
  }
});

test("a timeout names the provider in each language", () => {
  for (const language of LANGUAGES) {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const failure = providerFailure(timeout, provider, translatorFor(language));
    if (failure.code === "PROVIDER_TIMEOUT") assert.equal(failure.message, TIMEOUT[language]);
    assert.ok(failure.message.includes("OpenAI"));
  }
});

test("a training-risk refusal carries the provider label in each language", () => {
  const messages = LANGUAGES.map((language) => providerFailure(new TrainingRiskRefusal("DeepSeek"), provider, translatorFor(language)).message);
  assert.equal(new Set(messages).size, 6);
  for (const message of messages) assert.ok(message.includes("DeepSeek"));
  assert.match(messages[2] ?? "", /Modelleinstellungen/);
  assert.match(messages[4] ?? "", /モデル設定/);
});

test("the turn failures keep their numbers and reasons in each language", () => {
  for (const language of LANGUAGES) {
    const t = translatorFor(language);
    assert.ok(stepLimitFailure(t, 12).message.includes("12"));
    const context = contextLimitFailure(t, { reduced: 210_000, budget: 200_000 }).message;
    assert.ok(context.includes("210k") && context.includes("200k"));
    assert.ok(planRejectedFailure(t, { code: "X", message: "no layer" }).message.includes("no layer"));
    assert.notEqual(cancelledFailure(t).message, "");
  }
  assert.match(cancelledFailure(translatorFor("de")).message, /gestoppt/);
  assert.match(stepLimitFailure(translatorFor("ja"), 5).message, /5ステップ/);
});

test("an invalid model setting is reported in each language", () => {
  const messages = LANGUAGES.map((language) => applySlotUpdates({}, { primary: { service: "nowhere" } }, translatorFor(language)));
  const errors = messages.map((outcome) => ("error" in outcome ? outcome.error : ""));
  assert.equal(errors[0], 'Unknown service "nowhere".');
  assert.equal(errors[2], "Unbekannter Dienst „nowhere“.");
  assert.equal(errors[5], "未知的服务“nowhere”。");
  assert.equal(new Set(errors).size, 6);
});

async function call(port: number, method: string, path: string, body: JsonValue): Promise<JsonValue> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  return decodeOrThrow(jsonValue, await response.json());
}

const ROUTE_TEXT: Record<Language, { stop: string; steer: string }> = {
  en: { stop: "Nothing was running.", steer: "That turn has already finished; send this as a new message." },
  es: { stop: "No había nada en ejecución.", steer: "Ese turno ya terminó; envíalo como un mensaje nuevo." },
  de: { stop: "Es lief nichts.", steer: "Dieser Durchgang ist bereits beendet; sende dies als neue Nachricht." },
  fr: { stop: "Rien n'était en cours.", steer: "Ce tour est déjà terminé ; envoyez-le comme un nouveau message." },
  ja: { stop: "実行中のものはありませんでした。", steer: "そのターンはすでに終了しています。新しいメッセージとして送信してください。" },
  "zh-Hans": { stop: "没有正在运行的任务。", steer: "该轮已经结束；请作为新消息发送。" },
};

test("the stop reply and a refused steering message speak the interface language", async (t) => {
  const harness = await startUiSidecar(t);
  const tags: Record<Language, string> = { en: "en_US", es: "es_ES", de: "de_DE", fr: "fr_FR", ja: "ja_JP", "zh-Hans": "zh_CN" };
  for (const language of LANGUAGES) {
    harness.sidecar.hostFacts.isoLanguage = tags[language];
    const stopped = await call(harness.port, "POST", "/v1/ui/stop", {});
    assert.equal(fieldOf(stopped, "message"), ROUTE_TEXT[language].stop);
    const steered = await call(harness.port, "POST", "/v1/chat/steer", { requestId: "gone", message: "more" });
    assert.equal(fieldOf(steered, "error.message"), ROUTE_TEXT[language].steer);
  }
});

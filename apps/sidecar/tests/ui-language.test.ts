/** The interface language the sidecar reports: the user's choice, then the installer's file, then After Effects' language, then English. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { authorization } from "./sidecar-fixture.js";
import { startUiSidecar } from "./ui-fixture.js";
import { fieldOf } from "./http-json.js";
import { decodeOrThrow, jsonValue, type JsonValue } from "@extynt/decode";

type Test = { after: (fn: () => void | Promise<void>) => void };

async function call(port: number, method: string, path: string, body?: JsonValue): Promise<JsonValue> {
  const init = { method, headers: { ...authorization, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return decodeOrThrow(jsonValue, await response.json());
}

const bootstrapLanguage = async (port: number): Promise<JsonValue | undefined> => fieldOf(await call(port, "GET", "/v1/ui/bootstrap"), "interfaceLanguage");

async function started(t: Test, installerLine: string | null) {
  const harness = await startUiSidecar(t);
  if (installerLine !== null) writeFileSync(join(harness.stateDirectory, "ui-language"), installerLine);
  return harness;
}

test("with nothing else to go on the interface is English", async (t) => {
  const harness = await started(t, null);
  assert.equal(await bootstrapLanguage(harness.port), "en");
});

test("After Effects' language is used once the host has reported it, and an unsupported one falls through to English", async (t) => {
  const harness = await started(t, null);
  harness.sidecar.hostFacts.isoLanguage = "de_DE";
  assert.equal(await bootstrapLanguage(harness.port), "de");
  harness.sidecar.hostFacts.isoLanguage = "ko_KR";
  assert.equal(await bootstrapLanguage(harness.port), "en");
});

test("the installer's file outranks After Effects, and a locale tag on its first line is understood", async (t) => {
  const harness = await started(t, "fr-FR\nignored\n");
  harness.sidecar.hostFacts.isoLanguage = "ja_JP";
  assert.equal(await bootstrapLanguage(harness.port), "fr");
});

test("the user's choice outranks the installer, applies at once, and Automatic returns to the order", async (t) => {
  const harness = await started(t, "es");
  const chosen = await call(harness.port, "PATCH", "/v1/ui/prefs", { language: "zh-Hans" });
  assert.equal(fieldOf(chosen, "interfaceLanguage"), "zh-Hans");
  assert.equal(fieldOf(chosen, "prefs.language"), "zh-Hans");
  assert.equal(await bootstrapLanguage(harness.port), "zh-Hans");
  const automatic = await call(harness.port, "PATCH", "/v1/ui/prefs", { language: "auto" });
  assert.equal(fieldOf(automatic, "interfaceLanguage"), "es");
});

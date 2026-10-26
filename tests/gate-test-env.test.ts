// scripts/run-tests.ts testEnvironment: test processes get a canonical TMPDIR and cannot see the developer's real probe evidence.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { LIVE_KEY_VARIABLE, liveKeyEnvironment, liveTestEnvironment, testEnvironment } from "../scripts/run-tests.ts";
import { loadEffectControlEvidence } from "../apps/sidecar/dist/src/profile-store.js";

test("TMPDIR is the real path even when the system temp directory is reached through a symlink", (t) => {
  const real = mkdtempSync(join(realpathSync(tmpdir()), "extynt-env-real-"));
  const link = `${real}-link`;
  symlinkSync(real, link);
  const previous = process.env.TMPDIR;
  t.after(() => {
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    rmSync(link, { force: true });
    rmSync(real, { recursive: true, force: true });
  });
  process.env.TMPDIR = link;
  assert.equal(tmpdir(), link);
  assert.equal(testEnvironment({}).TMPDIR, real);
});

function evidencePath(environment: NodeJS.ProcessEnv): string {
  const path = environment.EXTYNT_EFFECT_CONTROLS;
  assert.ok(path !== undefined);
  return path;
}

test("the effect-control evidence path is fresh, absent and beats an inherited one", () => {
  const base = { EXTYNT_EFFECT_CONTROLS: "/inherited/evidence.json", KEEP: "1" };
  const first = testEnvironment(base);
  const second = testEnvironment(base);
  assert.equal(first.KEEP, "1");
  assert.notEqual(evidencePath(first), "/inherited/evidence.json");
  assert.notEqual(evidencePath(first), evidencePath(second));
  assert.equal(existsSync(dirname(evidencePath(first))), false);
  assert.equal(evidencePath(first).startsWith(realpathSync(tmpdir())), true);
});

test("a missing evidence file reads as no evidence", () => {
  assert.equal(loadEffectControlEvidence(evidencePath(testEnvironment({}))), undefined);
});

function jevEnvironmentWith(key: string): { readonly home: string; readonly jevEnvFile: string; cleanup(): void } {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "extynt-env-home-"));
  const jevEnvFile = join(home, ".config", "extynt", "jev.env");
  mkdirSync(dirname(jevEnvFile), { recursive: true });
  writeFileSync(jevEnvFile, `TYPESAFE_API_KEY=${key}\n`);
  return { home, jevEnvFile, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("the offline environment never yields a live key, even with a developer jev.env present", (t) => {
  const { home, cleanup } = jevEnvironmentWith("jev-key-from-file");
  t.after(cleanup);
  const environment = testEnvironment({ HOME: home, TYPESAFE_API_KEY: "exported", [LIVE_KEY_VARIABLE]: "inherited" });
  assert.equal(environment[LIVE_KEY_VARIABLE], undefined);
  assert.equal(environment.TYPESAFE_API_KEY, undefined);
  assert.equal(Object.values(environment).includes("jev-key-from-file"), false);
});

test("the live environment reads the developer's jev.env through the injected path and never prints it", (t) => {
  const { jevEnvFile, cleanup } = jevEnvironmentWith("jev-key-from-file");
  t.after(cleanup);
  assert.deepEqual(liveKeyEnvironment({}, jevEnvFile), { [LIVE_KEY_VARIABLE]: "jev-key-from-file" });
  assert.deepEqual(liveKeyEnvironment({}, join(dirname(jevEnvFile), "absent.env")), {});
});

test("an exported TypeSafe key moves into the live variable only in the live environment", () => {
  const environment = liveTestEnvironment({ TYPESAFE_API_KEY: "exported", TYPESAFE_MODEL: "m", TYPESAFE_BASE_URL: "u", EXTYNT_DECISION_MODELS: "[]", KEEP: "1" });
  assert.equal(environment[LIVE_KEY_VARIABLE], "exported");
  for (const name of ["TYPESAFE_API_KEY", "TYPESAFE_MODEL", "TYPESAFE_BASE_URL", "EXTYNT_DECISION_MODELS"]) assert.equal(environment[name], undefined, name);
  assert.equal(environment.KEEP, "1");
  assert.equal(testEnvironment({ TYPESAFE_API_KEY: "exported" })[LIVE_KEY_VARIABLE], undefined);
});

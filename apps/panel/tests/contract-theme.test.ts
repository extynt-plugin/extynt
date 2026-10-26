/** Panel contract: what the host injects. The theme it follows live, and the sessions the page refuses to trust. */
import assert from "node:assert/strict";
import test from "node:test";
import { createPanelHarness, NATIVE, type PanelHarness } from "./contract.test.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

function themeOf(harness: PanelHarness): string | null {
  return harness.document.documentElement.getAttribute("data-theme");
}
function booted(theme: JsonValue): PanelHarness {
  return createPanelHarness({ native: { ...NATIVE, theme } });
}
function retheme(harness: PanelHarness, detail?: JsonValue): void {
  harness.dispatchWindow("extynt-theme", detail === undefined ? {} : { detail });
}
function nativeWithout(...omitted: string[]): JsonObject {
  return Object.fromEntries(Object.entries(NATIVE).filter(([key]) => !omitted.includes(key)));
}

test("a dark host boots the panel dark, a light host boots it light", () => {
  assert.equal(themeOf(booted({ background: "#16171b", luminance: 0.09 })), "dark");
  assert.equal(themeOf(booted({ background: "#f5f6f8", luminance: 0.96 })), "light");
});

test("the split is at half luminance: just under is dark, exactly half is light", () => {
  assert.equal(themeOf(booted({ background: "#7f7f7f", luminance: 0.4999 })), "dark");
  assert.equal(themeOf(booted({ background: "#808080", luminance: 0.5 })), "light");
  assert.equal(themeOf(booted({ background: "#000000", luminance: 0 })), "dark");
  assert.equal(themeOf(booted({ background: "#ffffff", luminance: 1 })), "light");
});

test("with no theme the attribute is absent, so the stylesheet follows the system scheme", () => {
  const harness = createPanelHarness({ native: nativeWithout("theme"), prefersDark: true });
  assert.equal(themeOf(harness), null);
  assert.ok(harness.requests.length > 0, "the panel still works");
});

test("a malformed theme at boot is treated as no theme", () => {
  const bad: JsonValue[] = [
    "dark",
    7,
    [],
    { luminance: 0.2 },
    { background: "#16171b" },
    { background: "16171b", luminance: 0.2 },
    { background: "#16171", luminance: 0.2 },
    { background: "rgb(0,0,0)", luminance: 0.2 },
    { background: "#16171b", luminance: "0.2" },
    { background: "#16171b", luminance: 1.5 },
    { background: "#16171b", luminance: -0.1 },
    { background: "#16171b", luminance: Number.NaN },
  ];
  for (const theme of bad) assert.equal(themeOf(booted(theme)), null, JSON.stringify(theme));
});

test("an extynt-theme event re-themes the page live, both ways", () => {
  const harness = booted({ background: "#16171b", luminance: 0.09 });
  retheme(harness, { background: "#f5f6f8", luminance: 0.96 });
  assert.equal(themeOf(harness), "light");
  retheme(harness, { background: "#16171b", luminance: 0.09 });
  assert.equal(themeOf(harness), "dark");
});

test("a theme event can arrive for a page that booted with no theme", () => {
  const harness = createPanelHarness({ native: nativeWithout("theme") });
  retheme(harness, { background: "#f5f6f8", luminance: 0.96 });
  assert.equal(themeOf(harness), "light");
});

test("a malformed theme event removes the attribute, and the next good one sets it again", () => {
  const harness = booted({ background: "#16171b", luminance: 0.09 });
  const malformed: Array<JsonValue | undefined> = [null, undefined, "light", { background: "#fff", luminance: 0.9 }, { background: "#f5f6f8" }];
  for (const detail of malformed) {
    retheme(harness, { background: "#16171b", luminance: 0.09 });
    retheme(harness, detail);
    assert.equal(themeOf(harness), null, JSON.stringify(detail));
  }
  retheme(harness, { background: "#f5f6f8", luminance: 0.96 });
  assert.equal(themeOf(harness), "light");
});

test("an event with no detail at all removes the attribute", () => {
  const harness = booted({ background: "#16171b", luminance: 0.09 });
  harness.dispatchWindow("extynt-theme");
  assert.equal(themeOf(harness), null);
});

test("a session from a non-loopback or mismatched origin is rejected: no requests, no theme", () => {
  const origins = [
    "http://evil.example:3210",
    "https://127.0.0.1:3210",
    "http://127.0.0.1:4000",
    "http://127.0.0.1",
    "http://localhost:3210",
    "http://127.0.0.1:3210/",
    "http://127.0.0.1:3210/v1",
    "",
    3210,
  ];
  for (const sidecarOrigin of origins) {
    const harness = createPanelHarness({ native: { ...NATIVE, sidecarOrigin } });
    assert.equal(harness.requests.length, 0, "no request to " + String(sidecarOrigin));
    assert.equal(themeOf(harness), null, "no theme from " + String(sidecarOrigin));
  }
});

test("a session whose token is malformed is rejected", () => {
  const tokens = ["", "has space", "semi;colon", "new\nline", "x".repeat(257), 12345, null];
  for (const token of tokens) {
    const harness = createPanelHarness({ native: { ...NATIVE, token } });
    assert.equal(harness.requests.length, 0, "no request with token " + JSON.stringify(token));
  }
});

test("a missing or non-object injection is rejected", () => {
  assert.equal(createPanelHarness({ native: null }).requests.length, 0);
  assert.equal(createPanelHarness({ native: { theme: NATIVE.theme } }).requests.length, 0);
});

test("a valid session is used exactly as injected: its token, its origin, its versions", () => {
  const harness = createPanelHarness({
    native: { ...NATIVE, token: "Abc_def-123", pluginVersion: "0.1.0", aeVersion: "25.6", extra: "ignored" },
  });
  assert.ok(harness.requests.length > 0);
  for (const record of harness.requests) {
    assert.equal(record.headers.Authorization, "Bearer Abc_def-123");
    assert.ok(record.url.startsWith("http://127.0.0.1:3210/"));
  }
  assert.match(harness.el("diag-product")?.textContent ?? "", /plugin 0\.1\.0 · After Effects 25\.6$/);
});

test("a session without versions still works and Debug does not invent them", () => {
  const harness = createPanelHarness({ native: nativeWithout("pluginVersion", "aeVersion") });
  assert.ok(harness.requests.length > 0);
  assert.match(harness.el("diag-product")?.textContent ?? "", /^UI \S+$/);
});

/** Fixtures the Memory suites share: a fake notes sidecar, a booted panel over it, and readers for the Settings section. */
import assert from "node:assert/strict";
import { StubElement, createPanelHarness, type StubResponse } from "./contract.test.js";
import { readJson, recordOf, fieldOf } from "./json-narrow.js";
import { element, nth } from "./contract-helpers.js";
import { type JsonObject } from "@extynt/decode";

/** The note caps the sidecar reports. */
export const CAPS = { perEffect: 5, perControl: 2 };
/** The match name of the effect the history suites look up. */
export const GLOW = "ADBE Glo2";
/** A successful notes answer with the given fields. */
export const ok = (extra: JsonObject): StubResponse => ({
  status: 200,
  text: JSON.stringify({ ok: true, writeAuthorizing: false, ...extra }),
});
/** A refusal with the given status and code, wording the panel must not show. */
export const refused = (status: number, code: string, extra: JsonObject = {}): StubResponse => ({
  status,
  text: JSON.stringify({ ok: false, error: { code, message: "internal wording" }, ...extra, writeAuthorizing: false }),
});
/** A current note. */
export const note = (id: string, extra: JsonObject = {}): JsonObject => ({
  id,
  kind: "agent-inferred",
  trust: "labelled-guess",
  controlPath: "ADBE Glo2-0001",
  text: `Note ${id}.`,
  value: null,
  effectVersion: null,
  aeBuild: "26",
  createdAt: 1,
  stale: false,
  staleReason: null,
  ...extra,
});
/** A replaced note. */
export const gone = (id: string, extra: JsonObject = {}): JsonObject =>
  note(id, {
    state: "replaced",
    replacedBy: "c1",
    replaceReason: "Cleaner.",
    replacedAt: Date.UTC(2026, 9, 3),
    matchName: GLOW,
    pluginKey: "Stylize",
    ...extra,
  });

interface Call {
  method: string;
  path: string;
  body: JsonObject;
}
interface Sidecar {
  learn: boolean;
  learned: JsonObject | undefined;
  plugins: Array<{ pluginKey: string; effectCount: number; optedIn: boolean }>;
  failing: Set<string>;
  calls: Call[];
  currentIds: string[];
  current: Array<JsonObject>;
  replaced: Array<JsonObject>;
  restore: (call: Call) => StubResponse;
}
const settingsBody = (s: Sidecar): JsonObject => ({
  learnFromWork: s.learn,
  optedIn: s.plugins.filter((p) => p.optedIn).map((p) => ({ pluginKey: p.pluginKey, enabledAt: 1 })),
  plugins: s.plugins,
  hostKey: "k",
  ...(s.learned ? { learned: s.learned } : {}),
});
const historyBody = (s: Sidecar): JsonObject => ({
  notes: s.replaced,
  current: {
    effect: { matchName: GLOW, displayName: "Glow", category: "Stylize", version: null, pluginKey: "Stylize" },
    notes: s.current,
    noteIds: s.currentIds,
    caps: CAPS,
  },
});

type Route = (s: Sidecar, call: Call) => StubResponse;
const ROUTES: Record<string, Route> = {
  "/v1/notes/settings": (s) => ok(settingsBody(s)),
  "/v1/notes/learn-from-work": (s, call) => {
    s.learn = fieldOf(call.body, "enabled") === true;
    return ok({ learnFromWork: s.learn });
  },
  "/v1/notes/usage/forget": () => ok({ removed: 4 }),
  "/v1/notes/plugins": (s, call) => {
    const plugin = s.plugins.find((p) => p.pluginKey === fieldOf(call.body, "pluginKey"));
    if (plugin) plugin.optedIn = fieldOf(call.body, "enabled") === true;
    return ok({ pluginKey: fieldOf(call.body, "pluginKey") ?? null, enabled: fieldOf(call.body, "enabled") ?? null });
  },
  "/v1/notes/history": (s) => ok(historyBody(s)),
  "/v1/notes/restore": (s, call) => s.restore(call),
  "/v1/notes/forget": () => ok({ removed: 1 }),
};

function answer(s: Sidecar, call: Call): StubResponse {
  if (s.failing.has(call.path)) return refused(503, "EFFECT_NOTES_UNAVAILABLE");
  const route = ROUTES[nth(call.path.split("?"), 0)];
  return route ? route(s, call) : ok({});
}

/** A panel booted over a fake notes sidecar holding `partial` over the defaults. */
export function world(partial: Partial<Sidecar> = {}) {
  const sidecar: Sidecar = {
    learn: true,
    learned: undefined,
    plugins: [
      { pluginKey: "Blur", effectCount: 2, optedIn: false },
      { pluginKey: "Stylize", effectCount: 5, optedIn: true },
    ],
    failing: new Set(),
    calls: [],
    currentIds: ["c1", "c2"],
    current: [note("c1"), note("c2")],
    replaced: [gone("r1")],
    restore: () => ok({}),
    ...partial,
  };
  const harness = createPanelHarness({
    respond: (record) => {
      const path = record.url.replace("http://127.0.0.1:3210", "");
      if (!path.startsWith("/v1/notes/")) return undefined;
      const call: Call = { method: record.method, path, body: record.body ? recordOf(readJson(record.body)) : {} };
      sidecar.calls.push(call);
      return answer(sidecar, call);
    },
  });
  return { harness, sidecar };
}
/** A booted panel with its fake notes sidecar. */
export type World = ReturnType<typeof world>;

/** The requests the sidecar saw for a path. */
export const callsTo = (w: World, path: string): Call[] => w.sidecar.calls.filter((call) => call.path.split("?")[0] === path);
/** Opens Settings. */
export const openSettings = (w: World): void => {
  w.harness.click("open-settings");
};
/** The text of an element. */
export const text = (w: World, id: string): string => element(w.harness, id).textContent;
/** The memory section's status line. */
export const status = (w: World): string => text(w, "memory-status");
/** Types a value into an input. */
export const type = (w: World, id: string, value: string): void => {
  const input = element(w.harness, id);
  input.value = value;
  input.dispatch("input");
};
/** The buttons inside an element whose label matches. */
export const buttons = (w: World, id: string, label: RegExp): StubElement[] =>
  element(w.harness, id).all((node) => node.tagName === "BUTTON" && label.test(node.textContent));
/** The one node of a list; any other count fails. */
export const only = (nodes: StubElement[]): StubElement => {
  assert.equal(nodes.length, 1, "exactly one");
  return nth(nodes, 0);
};
/** The plugin checkboxes. */
export const pluginBoxes = (w: World): StubElement[] => element(w.harness, "memory-plugins").all((node) => node.tagName === "INPUT");
/** The checkbox for one plugin. */
export const boxFor = (w: World, key: string): StubElement =>
  only(pluginBoxes(w).filter((box) => box.getAttribute("aria-label") === `Document ${key}`));
/** Fails when a line shows an error code or internal wording. */
export const withoutCodes = (line: string): void =>
  assert.ok(!/EFFECT_NOTES|STALE_PANEL|HTTP|503|409|internal wording/.test(line), `no code reaches the user: ${line}`);
/** Presses a two-press button inside its window. */
export const pressTwice = (w: World, button: StubElement): void => {
  button.click();
  w.harness.advance(100);
  button.click();
};

/** Opens Settings and shows the notes of an effect. */
export function showNotes(w: World, typed = GLOW): void {
  w.harness.click("open-settings");
  type(w, "notes-effect", typed);
  w.harness.click("notes-show");
}

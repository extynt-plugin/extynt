// The panel's effect-notes routes: settings, history, restore and forget. Paired panel only; none of it touches a project, a plan or After Effects.
import { array, boolean, literal, map, object, optional, string, taggedUnion, type Decoder, type Infer } from "@extynt/decode";

import type { EffectNotesService } from "./effect-notes-service.js";
import type { ForgetRequest } from "./effect-notes-input.js";
import type { NoteFailure } from "./effect-notes-types.js";
import { jsonBody, type BodySpec } from "./server-route-body.js";
import { answer, bodyRoute, route, type MountedRoute, type RouteReply } from "./server-route-table.js";
import { requirePairedPanel } from "./server-paired-panel.js";

const NOTES_BODY_LIMIT_BYTES = 65_536;
const CONFLICT_CODES: ReadonlySet<string> = new Set(["EFFECT_NOTES_STALE", "EFFECT_NOTES_CAP_REACHED", "EFFECT_NOTES_DOCUMENTATION_OFF"]);
const UNPROCESSABLE_CODES: ReadonlySet<string> = new Set(["EFFECT_NOTES_INVALID", "EFFECT_NOTES_UNKNOWN_EFFECT", "EFFECT_NOTES_REPLACE_INVALID", "EFFECT_NOTES_NOT_FOUND"]);

const requirePanel = requirePairedPanel("Effect notes settings require the paired panel instance.");
const MALFORMED = { status: 400, code: "INVALID_JSON", message: "The request must be a JSON object under 64 KB." } as const;
const UNMATCHED = { status: 422, code: "EFFECT_NOTES_INVALID", message: "The request body does not match this notes route." } as const;

function notesBody<Body>(decoder: Decoder<Body>): BodySpec<Body> {
  return { ...jsonBody(decoder, NOTES_BODY_LIMIT_BYTES, UNMATCHED, { tooLarge: MALFORMED, notJson: MALFORMED }), emptyAsObject: true };
}

const learnFromWork = object({ enabled: boolean() });
const pluginOptIn = object({ pluginKey: string(), enabled: boolean() });
const restoreNote = object({ noteId: string(), expectedNoteIds: array(string()), replaces: optional(string()), reason: optional(string()) });
const wireScope = taggedUnion("scope", {
  note: object({ scope: literal("note"), noteId: string() }),
  effect: object({ scope: literal("effect"), matchName: string() }),
  plugin: object({ scope: literal("plugin"), pluginKey: string() }),
});

function scopeOf(wire: Infer<typeof wireScope>): ForgetRequest {
  switch (wire.scope) {
    case "note": return { kind: "note", noteId: wire.noteId };
    case "effect": return { kind: "effect", matchName: wire.matchName };
    case "plugin": return { kind: "plugin", pluginKey: wire.pluginKey };
  }
}

const forgetScope = map(wireScope, scopeOf);

function historyOf(service: EffectNotesService, matchName: string | undefined) {
  const listed = service.audit(matchName === undefined ? {} : { matchName });
  if (!listed.ok || matchName === undefined) return listed;
  const current = service.read({ matchName });
  return { ...listed, current: current.ok ? { effect: current.effect, notes: current.notes, noteIds: current.noteIds, caps: current.caps } : null };
}

function statusOf(code: string): number {
  return CONFLICT_CODES.has(code) ? 409 : UNPROCESSABLE_CODES.has(code) ? 422 : 503;
}

function replyOf<Success extends { readonly ok: true }>(result: Success | NoteFailure): RouteReply<Success | { ok: false; error: { code: string; message: string }; current?: NoteFailure["current"]; writeAuthorizing: false }> {
  if (result.ok) return answer(200, result);
  const failure = { ok: false as const, error: { code: result.code, message: result.message }, ...(result.current ? { current: result.current } : {}), writeAuthorizing: false as const };
  return { ...answer(statusOf(result.code), failure, "rejected"), errorCode: result.code };
}

/** The `/v1/notes/*` routes of the panel's effect-notes settings and history. */
export const notesRoutes: readonly MountedRoute[] = [
  route({ method: "GET", path: "/v1/notes/settings", guard: requirePanel, handle: ({ deps }) => answer(200, deps.state.collection.effectNotes.settingsView()) }),
  bodyRoute({ method: "POST", path: "/v1/notes/learn-from-work", guard: requirePanel, body: notesBody(learnFromWork), handle: ({ deps, body: input }) => replyOf(deps.state.collection.effectNotes.setLearnFromWork(input.enabled)) }),
  bodyRoute({ method: "POST", path: "/v1/notes/usage/forget", guard: requirePanel, body: notesBody(object({})), handle: ({ deps }) => replyOf(deps.state.collection.effectNotes.forgetUsage()) }),
  bodyRoute({ method: "POST", path: "/v1/notes/plugins", guard: requirePanel, body: notesBody(pluginOptIn), handle: ({ deps, body: input }) => replyOf(deps.state.collection.effectNotes.setPluginOptIn(input)) }),
  route({ method: "GET", path: "/v1/notes/history", guard: requirePanel, handle: ({ deps, url }) => replyOf(historyOf(deps.state.collection.effectNotes, url.searchParams.get("matchName") ?? undefined)) }),
  bodyRoute({ method: "POST", path: "/v1/notes/restore", guard: requirePanel, body: notesBody(restoreNote), handle: ({ deps, body: input }) => replyOf(deps.state.collection.effectNotes.restore(input)) }),
  bodyRoute({ method: "POST", path: "/v1/notes/forget", guard: requirePanel, body: notesBody(forgetScope), handle: ({ deps, body: input }) => replyOf(deps.state.collection.effectNotes.forget(input)) }),
];

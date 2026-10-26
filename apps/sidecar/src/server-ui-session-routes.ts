// The panel's stored preferences and chat sessions over HTTP: read and patch the preferences, list, read, write and delete sessions, choose the current one.
import { jsonBody, type Refusal } from "./server-route-body.js";
import { bodyRoute, ok, refuse, route, type MountedRoute } from "./server-route-table.js";
import { MAX_PREFS_BODY_BYTES, MAX_SESSION_BODY_BYTES, isSessionId } from "./ui-contract.js";
import { currentSessionBody, prefsPatch, sessionBody } from "./ui-decoders.js";
import { interfaceLanguageOf } from "./ui-language.js";
import { uiStoreFor } from "./ui-store.js";

const PREFS_INVALID: Refusal = { status: 422, code: "UI_PREFS_INVALID", message: "Send only known preferences with valid values." };
const SESSION_INVALID: Refusal = { status: 422, code: "UI_SESSION_INVALID", message: "A session is an object with a title, an optional project and createdAt, and messages that each have a kind and a text." };
const CURRENT_SESSION_INVALID: Refusal = { status: 422, code: "UI_SESSION_INVALID", message: "Send {\"id\": <session id or null>}." };
const SESSION_TOO_LARGE: Refusal = { status: 413, code: "UI_SESSION_TOO_LARGE", message: `The request body may be at most ${MAX_SESSION_BODY_BYTES} bytes.` };
const sessionNotFound = () => refuse(404, "UI_SESSION_NOT_FOUND", "There is no stored session with that id.");

/** The preference and session routes of the panel's own API. */
export const uiSessionRoutes: readonly MountedRoute[] = [
  route({ method: "GET", path: "/v1/ui/prefs", handle: ({ deps }) => ok({ ok: true, prefs: uiStoreFor(deps.state).prefs(), interfaceLanguage: interfaceLanguageOf(deps.state) }) }),
  bodyRoute({
    method: "PATCH", path: "/v1/ui/prefs", body: jsonBody(prefsPatch, MAX_PREFS_BODY_BYTES, PREFS_INVALID),
    handle: ({ deps, body }) => {
      const prefs = uiStoreFor(deps.state).patchPrefs(body);
      return ok({ ok: true, prefs, interfaceLanguage: interfaceLanguageOf(deps.state) });
    },
  }),
  route({
    method: "GET", path: "/v1/ui/sessions",
    handle: ({ deps }) => {
      const store = uiStoreFor(deps.state);
      return ok({ ok: true, sessions: store.listSessions(), currentSessionId: store.currentSessionId() });
    },
  }),
  route({ method: "DELETE", path: "/v1/ui/sessions", handle: ({ deps }) => { uiStoreFor(deps.state).clearSessions(); return ok({ ok: true }); } }),
  route({
    method: "GET", path: "/v1/ui/sessions/:id",
    handle: ({ deps, param }) => {
      const session = isSessionId(param) ? uiStoreFor(deps.state).getSession(param) : null;
      return session ? ok({ ok: true, session }) : sessionNotFound();
    },
  }),
  bodyRoute({
    method: "PUT", path: "/v1/ui/sessions/:id", body: jsonBody(sessionBody, MAX_SESSION_BODY_BYTES, SESSION_INVALID, { tooLarge: SESSION_TOO_LARGE }),
    handle: ({ deps, body, param }) => {
      if (body.id !== undefined && body.id !== param) return refuse(422, "UI_SESSION_INVALID", "The session id in the body does not match the path.");
      const stored = uiStoreFor(deps.state).putSession(param, body);
      return stored.ok ? ok({ ok: true, session: stored.value }) : refuse(stored.status, stored.code, stored.message);
    },
  }),
  route({
    method: "DELETE", path: "/v1/ui/sessions/:id",
    handle: ({ deps, param }) => (isSessionId(param) && uiStoreFor(deps.state).deleteSession(param) ? ok({ ok: true }) : sessionNotFound()),
  }),
  bodyRoute({
    method: "PUT", path: "/v1/ui/current-session", body: jsonBody(currentSessionBody, MAX_PREFS_BODY_BYTES, CURRENT_SESSION_INVALID),
    handle: ({ deps, body }) => {
      const chosen = uiStoreFor(deps.state).setCurrentSessionId(body.id);
      return chosen.ok ? ok({ ok: true, currentSessionId: chosen.value }) : refuse(chosen.status, chosen.code, chosen.message);
    },
  }),
];

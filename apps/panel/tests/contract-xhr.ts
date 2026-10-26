/** The XHR stub and the fake sidecar behind it: every route the panel calls, answered from state a test can change. */
import { fieldOf, readJson, recordOf, textAt, textOr } from "./json-narrow.js";
import { array, boolean, decode, jsonObject, type JsonObject, type JsonValue, number, object, optional, string } from "@extynt/decode";

/** What a responder says to one request. */
export type StubResponse = { status?: number; text?: string; fail?: boolean; timeout?: boolean; hold?: boolean };

/** The request headers the panel sets. */
export type StubHeaders = {
  Accept?: string;
  Authorization?: string;
  "Content-Type"?: string;
  "X-AE-Client"?: string;
  "X-AE-Correlation-Id"?: string;
  "X-AE-Panel-Build"?: string;
  "X-AE-Panel-Instance"?: string;
  "X-AE-Request-Id"?: string;
};

/** One request the panel made. */
export type StubRequestRecord = { method: string; url: string; body: string; headers: StubHeaders; timeoutMs?: number };

/** Answers a request, or declines it so the fake sidecar does. */
export type StubResponder = (record: StubRequestRecord) => StubResponse | undefined;

/** A chat the fake sidecar stores. */
export type FakeSession = { id: string; title: string; project: string | null; createdAt: number; updatedAt: number; messages: JsonObject[] };

/** The preferences the fake sidecar serves. */
export type FakePrefs = { askBeforeApplying: string; suggestPrompts: boolean; showThumbnails: boolean; rateLimit: boolean; diagnostics: boolean; language: string };

/** The state behind the fake sidecar's routes; a test changes it before or after boot. */
export type FakeSidecar = {
  prefs: FakePrefs;
  automaticLanguage: string;
  sessions: Map<string, FakeSession>;
  current: string | null;
  plans: JsonObject[];
  changes: JsonObject[];
  project: string | null;
  host: JsonObject;
  focus: JsonObject | null;
  quarantine: JsonValue;
  awaitingSnapshot?: boolean;
  jobs: JsonObject[];
  modelConfigured: boolean;
  thumbs: Map<string, JsonObject>;
  health: JsonObject;
  approve: (args: JsonObject) => StubResponse;
};

const prefsPatch = object({ askBeforeApplying: optional(string()), suggestPrompts: optional(boolean()), showThumbnails: optional(boolean()), rateLimit: optional(boolean()), diagnostics: optional(boolean()), language: optional(string()) });
const sessionBody = object({ title: string(), project: optional(string()), createdAt: optional(number()), messages: array(jsonObject) });

function json(value: JsonValue, status = 200): StubResponse {
  return { status, text: JSON.stringify(value) };
}

function refusal(status: number, code: string, message: string): StubResponse {
  return json({ ok: false, error: { code, message } }, status);
}

/** Replaces the plan with this id by a copy carrying `patch`. */
export function patchPlan(sidecar: FakeSidecar, planId: JsonValue | undefined, patch: JsonObject): void {
  sidecar.plans = sidecar.plans.map((plan) => (fieldOf(plan, "planId") === planId ? { ...plan, ...patch } : plan));
}

/** A sidecar with a connected host, one project, a configured model and no chats, plans or jobs. */
export function defaultSidecar(): FakeSidecar {
  const sidecar: FakeSidecar = {
    prefs: { askBeforeApplying: "risky", suggestPrompts: true, showThumbnails: true, rateLimit: true, diagnostics: true, language: "auto" },
    automaticLanguage: "en",
    sessions: new Map(),
    current: null,
    plans: [],
    changes: [],
    project: "Fixture.aep",
    host: { state: "online", since: Date.now() - 60000, instanceId: "native:1:1", pluginVersion: "0.1.0", aeVersion: "26.2", pid: 1, libraryVersion: "1", lastEventAt: null, idleAgeMs: 10, stall: null, busyKind: null },
    focus: null,
    quarantine: null,
    jobs: [],
    modelConfigured: true,
    thumbs: new Map(),
    health: { ok: true, service: "extynt-sidecar", agent: null, catalogue: null },
    approve: (args) => {
      patchPlan(sidecar, fieldOf(args, "planId"), { status: "verified", postcondition: "passed" });
      return json({ ok: true, data: { status: "verified", receipt: { status: "executed", postcondition: "passed" } } });
    },
  };
  return sidecar;
}

function summaryOf(session: FakeSession): JsonObject {
  return { id: session.id, title: session.title, project: session.project, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length };
}

function storedSession(id: string, body: string): FakeSession {
  const outcome = decode(sessionBody, readJson(body));
  if (!outcome.ok) throw new TypeError("a chat body the panel sent was not a chat: " + outcome.error.message);
  const { title, project, createdAt, messages } = outcome.value;
  return { id, title, project: project ?? null, createdAt: createdAt ?? Date.now(), updatedAt: Date.now(), messages: [...messages] };
}

function sessionRoute(sidecar: FakeSidecar, record: StubRequestRecord, path: string): StubResponse {
  if (path === "/v1/ui/sessions") {
    if (record.method === "DELETE") {
      sidecar.sessions.clear();
      sidecar.current = null;
      return json({ ok: true });
    }
    return json({ ok: true, sessions: [...sidecar.sessions.values()].map(summaryOf), currentSessionId: sidecar.current });
  }
  const id = decodeURIComponent(path.slice("/v1/ui/sessions/".length));
  const found = sidecar.sessions.get(id);
  if (record.method === "PUT") {
    const next = storedSession(id, record.body);
    sidecar.sessions.set(id, next);
    return json({ ok: true, session: { ...next, messages: next.messages } });
  }
  if (!found) return refusal(404, "UI_SESSION_NOT_FOUND", "No such chat.");
  if (record.method === "DELETE") {
    sidecar.sessions.delete(id);
    return json({ ok: true });
  }
  return json({ ok: true, session: { ...found, messages: found.messages } });
}

function modelPayload(configured: boolean): StubResponse {
  const slot = { service: "deepseek", model: "deepseek-v4", displayName: "DeepSeek", reasoningEffort: "high", keyConfigured: true, acceptsImages: true, trainingPolicy: "may-train", trainingRiskAcknowledged: true };
  const services: JsonObject[] = [
    { id: "deepseek", label: "DeepSeek", model: "deepseek-v4", baseUrl: "https://api.deepseek.com", keyRequired: true, trainingPolicy: "may-train" },
    { id: "anthropic", label: "Anthropic", model: "claude", baseUrl: "https://api.anthropic.com/v1", keyRequired: true, trainingPolicy: "no-training" },
    { id: "ollama", label: "Ollama (local)", model: "", baseUrl: "http://127.0.0.1:11434/v1", keyRequired: false, addressEditable: true, trainingPolicy: "no-training" },
  ];
  const slots = { primary: configured ? slot : null, fallback: null };
  return json({ ok: true, slots, active: slots, services, formats: {} });
}

function toolRoute(sidecar: FakeSidecar, record: StubRequestRecord): StubResponse {
  const body = recordOf(readJson(record.body));
  const name = textAt(body, "name");
  const args = recordOf(fieldOf(body, "arguments") ?? {});
  const planId = fieldOf(args, "planId");
  if (name === "ae_list_plans") return json({ ok: true, data: sidecar.plans });
  if (name === "ae_approve_plan") return sidecar.approve(args);
  if (name === "ae_cancel_plan") {
    patchPlan(sidecar, planId, { status: "cancelled" });
    return json({ ok: true, data: { status: "cancelled" } });
  }
  if (name === "ae_undo_plan") {
    patchPlan(sidecar, planId, { status: "undone" });
    return json({ ok: true, data: { status: "undone", receipt: { status: "executed" } } });
  }
  return json({ ok: true, data: {} });
}

function settingsRoute(sidecar: FakeSidecar, record: StubRequestRecord, path: string): StubResponse | null {
  if (path === "/v1/settings/model" && record.method === "GET") return modelPayload(sidecar.modelConfigured);
  if (path === "/v1/settings/model") {
    sidecar.modelConfigured = true;
    return modelPayload(true);
  }
  if (path === "/v1/settings/model/test") return json({ ok: true, provider: "DeepSeek", model: "deepseek-v4", ms: 400 });
  return null;
}

function interfaceLanguageOf(sidecar: FakeSidecar): string {
  return sidecar.prefs.language === "auto" ? sidecar.automaticLanguage : sidecar.prefs.language;
}

function bootstrapPayload(sidecar: FakeSidecar): JsonObject {
  return {
    ok: true, sidecarVersion: "0.1.0", mcpVersion: "0.1.0", uiBuild: "0123456789abcdef", host: sidecar.host, hostInstanceId: "native:1:1",
    awaitingSnapshot: sidecar.awaitingSnapshot === true, prefs: { ...sidecar.prefs }, interfaceLanguage: interfaceLanguageOf(sidecar), currentSessionId: sidecar.current,
    nativeAccessQuarantine: sidecar.quarantine, focus: sidecar.focus, project: sidecar.project, activity: { jobs: sidecar.jobs },
  };
}

function patchPrefs(sidecar: FakeSidecar, body: string): void {
  const outcome = decode(prefsPatch, readJson(body));
  if (outcome.ok) sidecar.prefs = { ...sidecar.prefs, ...outcome.value };
}

function uiRoute(sidecar: FakeSidecar, record: StubRequestRecord, path: string): StubResponse | null {
  if (path === "/v1/ui/bootstrap") return json(bootstrapPayload(sidecar));
  if (path === "/v1/ui/prefs") {
    if (record.method === "PATCH") patchPrefs(sidecar, record.body);
    return json({ ok: true, prefs: { ...sidecar.prefs }, interfaceLanguage: interfaceLanguageOf(sidecar) });
  }
  if (path.startsWith("/v1/ui/sessions")) return sessionRoute(sidecar, record, path);
  if (path === "/v1/ui/current-session") {
    const wanted = fieldOf(readJson(record.body), "id");
    sidecar.current = typeof wanted === "string" ? wanted : null;
    return json({ ok: true, currentSessionId: sidecar.current });
  }
  if (path === "/v1/ui/chat-logs/export") return json({ ok: true, path: "/tmp/extynt/Chat Logs/export.jsonl", sessions: sidecar.sessions.size, bytes: 10 });
  return null;
}

const CHANGED = new Set(["verified", "applied", "applied_unverified", "partially_undone", "undone"]);

function changeFor(plan: JsonObject): JsonObject {
  const undone = fieldOf(plan, "status") === "undone";
  return {
    planId: fieldOf(plan, "planId") ?? null, summary: fieldOf(plan, "summary") ?? null, appliedAt: fieldOf(plan, "updatedAt") ?? null, operations: 1,
    status: fieldOf(plan, "status") ?? null, mayHaveMutated: fieldOf(plan, "mayHaveMutated") === true, undoGroupsRemaining: undone ? 0 : 1,
    undo: undone ? { available: false, code: "ALREADY_UNDONE", reason: "already undone" } : { available: true }, source: "panel",
  };
}

function changesOf(sidecar: FakeSidecar): JsonObject[] {
  if (sidecar.changes.length) return sidecar.changes;
  return sidecar.plans.filter((plan) => CHANGED.has(textOr(fieldOf(plan, "status"), ""))).map(changeFor);
}

function thumbsRoute(sidecar: FakeSidecar, path: string): StubResponse {
  const pair = sidecar.thumbs.get(decodeURIComponent(path.slice("/v1/thumbs/".length)));
  return pair ? json({ ok: true, ...pair }) : refusal(404, "THUMBS_NOT_FOUND", "No frames.");
}

function dataRoute(sidecar: FakeSidecar, record: StubRequestRecord, path: string): StubResponse | null {
  if (path === "/v1/mcp/tools/call") return toolRoute(sidecar, record);
  if (path === "/v1/changes") return json({ ok: true, project: sidecar.project ? { name: sidecar.project, filePath: null } : null, changes: changesOf(sidecar), truncated: false });
  if (path.startsWith("/v1/thumbs/")) return thumbsRoute(sidecar, path);
  if (path === "/health") return json(sidecar.health);
  return null;
}

const QUIET_ROUTES = new Map<string, JsonValue>([
  ["/v1/chat-logs", { ok: true }],
  ["/v1/workflow/status", { ok: true, projection: { jobs: [], batches: [], activeJobId: null }, resume: null, pause: null }],
  ["/v1/chat/progress", { ok: true, progress: null }],
  ["/v1/variants", { ok: true, sets: [] }],
  ["/v1/notes/settings", { ok: true, learnFromWork: true, plugins: [], learned: "" }],
]);

/** The routes the panel calls, answered from the fake sidecar's state. */
export function sidecarResponder(sidecar: FakeSidecar): StubResponder {
  return (record) => {
    const path = (record.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]) ?? "";
    if (path === "/v1/ui/events") return { hold: true };
    const answered = uiRoute(sidecar, record, path) ?? settingsRoute(sidecar, record, path) ?? dataRoute(sidecar, record, path);
    return answered ?? json(QUIET_ROUTES.get(path) ?? { ok: true });
  };
}

const HEADER_NAMES = ["Accept", "Authorization", "Content-Type", "X-AE-Client", "X-AE-Correlation-Id", "X-AE-Panel-Build", "X-AE-Panel-Instance", "X-AE-Request-Id"] as const;

/** What the XHR class reports to and asks of the harness. */
export type XhrRig = { requests: StubRequestRecord[]; note: (kind: string, detail: string) => void; respond: StubResponder };

/** A request in flight or finished. */
export class StubXhr {
  public readyState = 0;
  public status = 0;
  public responseText = "";
  public timeout = 0;
  public method = "";
  public url = "";
  public aborted = false;
  public ended = false;
  public headers: StubHeaders = {};
  public onreadystatechange: (() => void) | null = null;
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public ontimeout: (() => void) | null = null;
  public onabort: (() => void) | null = null;
  public onprogress: (() => void) | null = null;
  public constructor(private readonly rig: XhrRig, private readonly held: StubXhr[]) {}
  public open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }
  public setRequestHeader(key: string, text: string): void {
    const name = HEADER_NAMES.find((known) => known === key);
    if (name) this.headers[name] = text;
  }
  public abort(): void {
    this.aborted = true;
    this.ended = true;
    this.onabort?.();
  }
  public send(body?: string | null): void {
    const record: StubRequestRecord = { method: this.method, url: this.url, body: typeof body === "string" ? body : "", headers: { ...this.headers }, timeoutMs: this.timeout };
    this.rig.requests.push(record);
    this.rig.note("xhr.send", this.method + " " + this.url.replace("http://127.0.0.1:3210", ""));
    const response = this.rig.respond(record) ?? { status: 200, text: '{"ok":true}' };
    if (response.hold) {
      this.held.push(this);
      this.status = 200;
    } else if (response.fail) this.fail();
    else if (response.timeout) this.timeOut();
    else this.respond(response.status ?? 200, response.text ?? "{}");
  }
  public respond(status: number, text: string): void {
    this.status = status;
    this.responseText = text;
    this.readyState = 4;
    this.ended = true;
    this.onreadystatechange?.();
    this.onload?.();
  }
  public push(text: string): void {
    this.responseText += text;
    this.onprogress?.();
  }
  public fail(): void {
    this.ended = true;
    this.onerror?.();
  }
  public timeOut(): void {
    this.ended = true;
    this.ontimeout?.();
  }
}

/** The XHR constructor the panel sees, plus the list of requests a responder held open. */
export function createXhrClass(rig: XhrRig): { StubXhr: new () => StubXhr; held: StubXhr[] } {
  const held: StubXhr[] = [];
  class BoundXhr extends StubXhr {
    public constructor() {
      super(rig, held);
    }
  }
  return { StubXhr: BoundXhr, held };
}

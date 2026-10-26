// Plain-JSON contract between the sidecar and the panel UI; the panel keeps its own copy of these types.
import type { Language, LanguageChoice } from "@extynt/ui-text";
import type { HostLinkStatus } from "./host/lane-types.js";
import type { JsonValue } from "@extynt/decode";
import type { SidecarState } from "./server-state.js";

export type AskBeforeApplying = "risky" | "always" | "never";
export interface UiPrefs { askBeforeApplying: AskBeforeApplying; suggestPrompts: boolean; showThumbnails: boolean; rateLimit: boolean; diagnostics: boolean; language: LanguageChoice }
export type UiPrefsPatch = Partial<UiPrefs>;
export const DEFAULT_UI_PREFS: UiPrefs = { askBeforeApplying: "risky", suggestPrompts: true, showThumbnails: true, rateLimit: true, diagnostics: false, language: "auto" };

/** A chat message as the panel stores it: a kind and a text, and whatever else the panel keeps on it. */
export interface UiMessage { readonly kind: string; readonly text: string; readonly [field: string]: JsonValue }
export interface UiSession { id: string; title: string; project: string | null; createdAt: number; updatedAt: number; messages: readonly UiMessage[] }
export interface UiSessionSummary { id: string; title: string; project: string | null; createdAt: number; updatedAt: number; messageCount: number }
export interface UiSessionInput { readonly title: string; readonly project?: string | null; readonly messages: readonly UiMessage[]; readonly createdAt?: number }

export interface UiFocus { project: string; compositionId: string | null; compositionName: string | null; selected: number; layerNames: string[]; at: number; kinds: string[]; selectionFingerprint: string | null }
export type UiQuarantine = ReturnType<SidecarState["nativeBridge"]["accessQuarantine"]>;
/** `awaitingSnapshot`: the host is paired but its first read of the project has not landed, so no tool can work yet. `interfaceLanguage`: the language the panel speaks, resolved from the user's choice, the installer and After Effects. */
export interface UiHostView { host: HostLinkStatus; hostInstanceId: string | null; nativeAccessQuarantine: UiQuarantine; awaitingSnapshot: boolean; interfaceLanguage: Language }
interface UiUndoState { available: boolean; reason: string | null; code?: string | null; steps?: number }

/** An interval the job spent waiting for the user's Apply (`to` is null while it still waits). Both ISO. The panel leaves these out of its time-left rate. */
export interface UiWait { from: string; to: string | null }
interface UiChecklistItem { id: string; title: string; phase: string; status: "open" | "verified" | "unbuilt"; verifiedAt?: string }
interface UiChecklistPhase { name: string; verified: number; total: number }
export interface UiChecklist { items: UiChecklistItem[]; phases: UiChecklistPhase[]; current: string | null }
/** A specialist the job's orchestrator consulted. `elapsedMs` is the final duration for done/failed rows and null while running (the panel counts from `startedAt`, so the event does not change every second). `label` is the registry label, never model text. */
export interface UiSpecialist { role: string; state: "running" | "done" | "failed"; startedAt: string; elapsedMs: number | null; label: string }
/** One workflow job as the sidecar is working on it, whichever request started it. `via`: the request itself, a self-continued cycle, or a resume after Apply. `startedAt` is ISO; `checklist` is null until the model or planner wrote one. */
export interface UiJob { jobId: string; requestId: string; goal: string; status: "working" | "applying" | "waiting-apply" | "waiting"; via: "request" | "self-continue" | "apply-resume"; activity: string; cycle: number; step: number; plansApplied: number; plansNotApplied: number; requestOpen: boolean; plans: string[]; startedAt: string; waits: UiWait[]; checklist: UiChecklist | null; specialists: UiSpecialist[] }
export interface UiActivity { jobs: UiJob[] }
/** One tool call an external agent made over MCP. */
export interface UiMcpCall { id: number; rev: number; at: string; tool: string; client: string; args: string; state: "running" | "ok" | "error"; code: string | null; ms: number | null; planIds: string[] }

export type UiEvent =
  | ({ type: "activity" } & UiActivity)
  | { type: "mcp"; calls: UiMcpCall[] }
  | ({ type: "host" } & UiHostView)
  | { type: "focus"; focus: UiFocus | null }
  | { type: "change"; seq: number; reason: string; planId?: string }
  | { type: "undo"; planId: string; undo: UiUndoState }
  | { type: "plans"; reason: string; planId?: string }
  | { type: "closing"; requestId: string; text: string }
  | { type: "thumbs"; planId: string }
  | { type: "preview"; setId: string }
  | { type: "decision"; reason: "open" | "changed" };

type UiFailure = { ok: false; status: number; code: string; message: string };
export type UiResult<T> = { ok: true; value: T } | UiFailure;

export const MAX_SESSIONS = 20;
export const MAX_SESSION_MESSAGES = 60;
export const MAX_SESSION_BYTES = 512 * 1024;
export const MAX_SESSION_BODY_BYTES = 1024 * 1024;
export const MAX_PREFS_BODY_BYTES = 4096;
export const MAX_FOCUS_LAYER_NAMES = 8;
export const MAX_FOCUS_KINDS = 16;

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PLAN_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** True for an id the panel may store a session under. */
export const isSessionId = (value: JsonValue | undefined): value is string => typeof value === "string" && SESSION_ID.test(value);

/** True for an id a plan may carry in a thumbnail path. */
export const isPlanId = (value: JsonValue | undefined): value is string => typeof value === "string" && PLAN_ID.test(value);

/** A refusal with the status and wire code the route answers with. */
export function failure(status: number, code: string, message: string): UiFailure { return { ok: false, status, code, message }; }

/** The ask-before-applying policy the auto-approve step reads. */
export function autoApplyPolicyOf(prefs: UiPrefs): AskBeforeApplying { return prefs.askBeforeApplying; }

/** The listing line of a stored session. */
export function summaryOf(session: UiSession): UiSessionSummary {
  return { id: session.id, title: session.title, project: session.project, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length };
}

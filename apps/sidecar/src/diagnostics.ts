// Structured request diagnostics: the closed vocabularies of events, phases and routes, and a sink that sanitizes every event before it is logged.
const DIAGNOSTIC_SCHEMA_VERSION = "0.1" as const;

const LEVELS = ["debug", "info", "warn", "error"] as const;
const EVENT_NAMES = ["request.started", "phase.started", "phase.completed", "request.completed"] as const;
const OUTCOMES = ["started", "succeeded", "rejected", "failed"] as const;
const METHODS = ["GET", "POST", "OPTIONS", "OTHER"] as const;
const PHASES = ["request", "route", "authentication", "health", "snapshot.body", "snapshot.parse", "snapshot.validate", "snapshot.store", "response"] as const;
const ROUTES = [
  "/health", "/v1/pair", "/v1/snapshots", "/v1/host-census", "/v1/snapshots/latest", "/v1/chat", "/v1/chat/progress", "/v1/chat/closing", "/v1/chat/steer", "/v1/chat-logs", "/v1/chat-logs/export",
  "/v1/settings/model", "/v1/settings/model/efforts", "/v1/settings/model/test", "/v1/mcp/tools", "/v1/mcp/tools/call", "/v1/panel/events", "/v1/panel/focus", "/v1/panel/shutdown",
  "/v1/pipeline", "/v1/captures", "/v1/diagnostics/export", "/v1/receipts/latest", "/v1/workflow/status", "/read-only-mutation", "/unknown",
] as const;

type DiagnosticLevel = (typeof LEVELS)[number];
type DiagnosticEventName = (typeof EVENT_NAMES)[number];
/** How a request or phase ended. */
export type DiagnosticOutcome = (typeof OUTCOMES)[number];
/** The HTTP methods diagnostics tell apart; anything else is OTHER. */
export type DiagnosticMethod = (typeof METHODS)[number];
/** The routes diagnostics name; any other path is /unknown. */
export type DiagnosticRoute = (typeof ROUTES)[number];
/** The stages of a request that report their own timing. */
export type DiagnosticPhase = (typeof PHASES)[number];

/** One sanitized diagnostic record of a request or a phase of it. */
export interface DiagnosticEvent {
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
  timestamp: string;
  level: DiagnosticLevel;
  event: DiagnosticEventName;
  phase: DiagnosticPhase;
  correlationId: string;
  requestId: string | null;
  method: DiagnosticMethod;
  route: DiagnosticRoute;
  outcome: DiagnosticOutcome;
  durationMs?: number;
  statusCode?: number;
  bytes?: number;
  errorCode?: string;
}

type DiagnosticEventInput = Omit<DiagnosticEvent, "schemaVersion" | "timestamp">;

/** Whether and where diagnostics are logged; `developmentOnly` keeps them disabled when NODE_ENV is production. */
export interface DiagnosticOptions {
  enabled?: boolean;
  developmentOnly?: boolean;
  environment?: string;
  logger?: (event: DiagnosticEvent) => void;
}

/** Where events go: `emit` sanitizes and logs, and does nothing while the sink is disabled. */
export interface DiagnosticSink {
  readonly enabled: boolean;
  emit(event: DiagnosticEventInput): void;
}

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** True when a path is one of the routes diagnostics name. */
export function isDiagnosticRoute(pathname: string): pathname is DiagnosticRoute {
  return within(ROUTES, pathname) !== undefined;
}

function within<Member extends string>(members: readonly Member[], candidate: string): Member | undefined {
  return members.find((member) => member === candidate);
}

function diagnosticDuration(value: number | undefined): Pick<DiagnosticEvent, "durationMs"> {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? { durationMs: Math.min(Math.floor(value), 86_400_000) } : {};
}

function diagnosticStatus(value: number | undefined): Pick<DiagnosticEvent, "statusCode"> {
  return value !== undefined && Number.isInteger(value) && value >= 100 && value <= 599 ? { statusCode: value } : {};
}

function diagnosticBytes(value: number | undefined): Pick<DiagnosticEvent, "bytes"> {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? { bytes: Math.min(value, 100_000_000) } : {};
}

function diagnosticError(value: string | undefined): Pick<DiagnosticEvent, "errorCode"> {
  return value !== undefined && /^[A-Z0-9_]{1,64}$/.test(value) ? { errorCode: value } : {};
}

function diagnosticOptionalFields(event: DiagnosticEvent): Pick<DiagnosticEvent, "durationMs" | "statusCode" | "bytes" | "errorCode"> {
  return { ...diagnosticDuration(event.durationMs), ...diagnosticStatus(event.statusCode), ...diagnosticBytes(event.bytes), ...diagnosticError(event.errorCode) };
}

function diagnosticVocabulary(event: DiagnosticEvent): Pick<DiagnosticEvent, "level" | "event" | "phase" | "method" | "route" | "outcome"> {
  return {
    level: within(LEVELS, event.level) ?? "error",
    event: within(EVENT_NAMES, event.event) ?? "phase.completed",
    phase: within(PHASES, event.phase) ?? "response",
    method: within(METHODS, event.method) ?? "OTHER",
    route: within(ROUTES, event.route) ?? "/unknown",
    outcome: within(OUTCOMES, event.outcome) ?? "failed",
  };
}

function sanitizeDiagnosticEvent(event: DiagnosticEvent): DiagnosticEvent {
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    timestamp: safeTimestamp(event.timestamp),
    ...diagnosticVocabulary(event),
    correlationId: sanitizeId(event.correlationId) ?? "invalid-correlation-id",
    requestId: event.requestId === null ? null : sanitizeId(event.requestId),
    ...diagnosticOptionalFields(event),
  };
}

/** A sink that logs sanitized events when enabled (and, by default, only outside production). */
export function createDiagnosticSink(options: DiagnosticOptions = {}): DiagnosticSink {
  const developmentOnly = options.developmentOnly ?? true;
  const environment = options.environment ?? process.env.NODE_ENV;
  const enabled = options.enabled === true && (!developmentOnly || environment !== "production");
  const logger = options.logger ?? ((event: DiagnosticEvent) => {
    console.debug(`[extynt diagnostic] ${JSON.stringify(event)}`);
  });
  return {
    enabled,
    emit(input) {
      if (!enabled) return;
      const event = sanitizeDiagnosticEvent({ ...input, schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, timestamp: new Date().toISOString() });
      logger(event);
    },
  };
}

function sanitizeId(value: string | null | undefined): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function safeTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

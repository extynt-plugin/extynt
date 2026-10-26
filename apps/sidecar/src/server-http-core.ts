// Transport primitives with no peer dependencies: answering, request diagnostics and change waiters, so anything that responds, logs or waits can be built on top without a cycle.
import { applyEffectControlEvidence, mergeEffectControlEvidence, type EffectProbeEvidence, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { decode, fallback, object, string, presentFields } from "@extynt/decode";

import type { CatalogueCollector } from "./catalogue-collector.js";
import type { CollectionService } from "./collection-service.js";
import type { DiagnosticOutcome, DiagnosticPhase } from "./diagnostics.js";
import { loadEffectControlEvidence } from "./profile-store.js";
import type { SidecarState } from "./server-state.js";
import type { RequestContext } from "./server-types.js";
import { AUTHORING_MS_CEILING, boundedElapsedMs } from "./server-durations.js";
import { writeJson } from "./server-http-wire.js";
import type { RespondInput } from "./sidecar-context.js";

type DiagnosticEventName = "request.started" | "phase.started" | "phase.completed" | "request.completed";
type PhaseFinish = { outcome: DiagnosticOutcome; statusCode?: number; bytes?: number; errorCode?: string };
type EventRecord = PhaseFinish & { durationMs?: number };
type CoreState = Pick<SidecarState, "catalogue" | "changeWaiters" | "collection" | "diagnostics" | "options" | "server">;

/** What the HTTP edge offers every route: phases, answers, change notification, bounded waits and effect evidence. */
export interface HttpCoreCapability {
  beginPhase(context: RequestContext, phase: DiagnosticPhase): number;
  emit(context: RequestContext, phase: DiagnosticPhase, event: DiagnosticEventName, record: EventRecord): void;
  endPhase(context: RequestContext, phase: DiagnosticPhase, startedAt: number, finish: PhaseFinish): void;
  notifyChange(): void;
  respond(input: RespondInput): void;
  waitUntil(predicate: () => boolean, seconds: number, signal?: AbortSignal): Promise<boolean>;
  withEffectEvidence(profile: HostCapabilityProfile | undefined): HostCapabilityProfile | undefined;
}

const plannedAnswer = object({ data: fallback(object({ planId: fallback(string(), undefined) }), undefined) });

function plannedIn(value: RespondInput["value"]): { planId?: string } {
  const read = decode(plannedAnswer, value);
  const planId = read.ok ? read.value.data?.planId : undefined;
  return planId === undefined ? {} : { planId };
}

function emitEvent(state: CoreState, context: RequestContext, event: { phase: DiagnosticPhase; name: DiagnosticEventName; record: EventRecord }): void {
  const { outcome } = event.record;
  state.diagnostics.emit({ level: outcome === "failed" ? "error" : outcome === "rejected" ? "warn" : "debug", event: event.name, phase: event.phase, correlationId: context.correlationId, requestId: context.requestId, method: context.method, route: context.route, ...event.record });
}

function respondWith(state: CoreState, input: RespondInput): void {
  const { context, statusCode, errorCode } = input;
  emitEvent(state, context, { phase: "response", name: "request.completed", record: presentFields({ outcome: input.outcome, statusCode, errorCode, bytes: input.bytes, durationMs: boundedElapsedMs(context.startedAt, AUTHORING_MS_CEILING) }) });
  context.answered = { statusCode, ...(errorCode ? { errorCode } : {}), ...plannedIn(input.value) };
  writeJson(input.response, statusCode, input.value);
}

function notifyChange(state: CoreState): void {
  const waiters = [...state.changeWaiters];
  state.changeWaiters.clear();
  for (const wake of waiters) wake();
}

function sleepUntilChange(state: CoreState, remaining: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    const wake = () => { cleanup(); resolve(); };
    const timer = setTimeout(wake, remaining);
    const cleanup = () => { clearTimeout(timer); state.changeWaiters.delete(wake); signal?.removeEventListener("abort", wake); };
    state.changeWaiters.add(wake);
    signal?.addEventListener("abort", wake);
    if (signal?.aborted) wake();
  });
}

async function waitUntil(state: CoreState, wait: { predicate: () => boolean; seconds: number; signal?: AbortSignal }): Promise<boolean> {
  const deadline = Date.now() + wait.seconds * 1000;
  while (!wait.predicate()) {
    if (wait.signal?.aborted) return false;
    const remaining = deadline - Date.now();
    if (remaining <= 0 || !state.server) return false;
    await sleepUntilChange(state, remaining, wait.signal);
  }
  return true;
}

function withEffectEvidence(state: CoreState, profile: HostCapabilityProfile | undefined): HostCapabilityProfile | undefined {
  const evidence = profile ? (state.options.effectControlEvidence ?? mergeEffectControlEvidence(loadEffectControlEvidence(), catalogueEvidence(state, profile))) : undefined;
  return profile && evidence ? applyEffectControlEvidence(profile, evidence) : profile;
}

/** The transport bound to one session's state. */
export function createHttpCore(deps: { readonly state: CoreState }): HttpCoreCapability {
  const { state } = deps;
  const capability: HttpCoreCapability = {
    beginPhase(context, phase) {
      const startedAt = Date.now();
      capability.emit(context, phase, "phase.started", { outcome: "started" });
      return startedAt;
    },
    endPhase: (context, phase, startedAt, finish) => capability.emit(context, phase, "phase.completed", presentFields({ ...finish, durationMs: boundedElapsedMs(startedAt, AUTHORING_MS_CEILING) })),
    emit: (context, phase, name, record) => emitEvent(state, context, { phase, name, record }),
    respond: (input) => respondWith(state, input),
    notifyChange: () => notifyChange(state),
    waitUntil: (predicate, seconds, signal) => waitUntil(state, presentFields({ predicate, seconds, signal })),
    withEffectEvidence: (profile) => withEffectEvidence(state, profile),
  };
  return capability;
}

/** Controls come only from what this machine's own probe observed and stored in the host catalogue graph. */
export function catalogueEvidence(state: { catalogue: Pick<CatalogueCollector, "userAssistedNames">; collection: Pick<CollectionService, "catalogueEvidence"> }, profile: HostCapabilityProfile, only?: readonly string[]): EffectProbeEvidence {
  const host = profile.host, observed = state.collection.catalogueEvidence(`${host.application}:${host.version}:${host.platform}`, only);
  const userAssisted = state.catalogue.userAssistedNames().filter((name) => !only || only.includes(name));
  return { host: { version: host.version }, ...(userAssisted.length ? { userAssisted } : {}), effects: observed.effects };
}

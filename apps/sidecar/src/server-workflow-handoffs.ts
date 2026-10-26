// The advisory specialist handoffs: coalesced writes of the orchestrations, transcripts and request checklists to the state directory, and their restore for the jobs that are still open after a restart.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { decode, fallback, type JsonValue, jsonValueWithin, object } from "@extynt/decode";
import type { WorkflowId } from "@extynt/workflow";

import { parseChecklists, serializeChecklists } from "./server-workflow-checklist.js";
import type { SidecarActionLedger } from "./server-workflow-sidecar-actions.js";
import type { WorkflowCoordinator } from "./workflow-coordinator.js";
import { parseWorkflowHandoffs } from "./workflow-handoff-parse.js";
import type { WorkflowOrchestrationBundle, WorkflowSpecialistRole, WorkflowSpecialistSession } from "./workflow-orchestration.js";

type HandoffSources = {
  readonly orchestrations: Map<WorkflowId, WorkflowOrchestrationBundle>;
  readonly sessions: Map<WorkflowId, Map<WorkflowSpecialistRole, WorkflowSpecialistSession>>;
  readonly actions: Map<WorkflowId, SidecarActionLedger>;
  readonly coordinator: Pick<WorkflowCoordinator, "workflowStore">;
};

type SessionMessage = WorkflowSpecialistSession["messages"][number];

const WRITE_DELAY_MS = 250;
const SAVED_DEPTH = 64;
const OPEN_STATUSES = ["open", "active", "blocked"];
const savedFile = object({ checklists: fallback(jsonValueWithin(24), undefined) });

function messageRecord(message: SessionMessage) {
  const tool = message.role === "tool";
  return { role: message.role, content: message.content, ...(tool && message.toolCallId ? { toolCallId: message.toolCallId } : {}), ...(tool && message.name ? { name: message.name } : {}) };
}

function sessionRecord(session: WorkflowSpecialistSession) {
  return {
    role: session.role, turns: session.turns, messages: session.messages.map(messageRecord),
    ...(session.activity ? { activity: session.activity } : {}), ...(session.brief ? { brief: session.brief } : {}), ...(session.error ? { error: session.error } : {}),
    ...(session.generation === undefined ? {} : { generation: session.generation }), ...(session.ownerSeenTurn === undefined ? {} : { ownerSeenTurn: session.ownerSeenTurn }),
    ...(session.ownerWokenTurn === undefined ? {} : { ownerWokenTurn: session.ownerWokenTurn }), ...(session.design ? { design: session.design } : {}),
  };
}

/** Specialist calls are advisory, but their completed handoffs are part of the workflow context and must survive a sidecar restart; writes are coalesced into one shortly after the last change, and `flush` writes at once. */
export class WorkflowHandoffs {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;

  public constructor(private readonly path: string, private readonly sources: HandoffSources) {}

  public persist(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, WRITE_DELAY_MS);
    this.timer.unref();
  }

  public flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.write();
    } catch {
      return;
    }
  }

  public restore(): void {
    try {
      this.load(readFileSync(this.path, "utf8"));
    } catch {
      return;
    }
  }

  private write(): void {
    const sessions = Object.fromEntries([...this.sources.sessions.entries()].map(([jobId, roles]) => [jobId, Object.fromEntries([...roles.entries()].map(([role, session]) => [role, sessionRecord(session)]))]));
    const payload = JSON.stringify({ version: 1, orchestrations: Object.fromEntries(this.sources.orchestrations), sessions, checklists: serializeChecklists(this.sources.actions) });
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
  }

  private openJobs(): ReadonlySet<string> {
    const { jobs } = this.sources.coordinator.workflowStore.getState();
    return new Set(Object.entries(jobs).filter(([, job]) => OPEN_STATUSES.includes(job.status)).map(([jobId]) => jobId));
  }

  private restoreChecklists(saved: JsonValue, open: ReadonlySet<string>): void {
    const file = decode(savedFile, saved);
    for (const [jobId, checklist] of parseChecklists(file.ok ? file.value.checklists : undefined)) {
      if (open.has(jobId)) this.sources.actions.set(jobId, { lines: [], unlooked: { batches: 0, lackVisual: false }, checklist });
    }
  }

  private load(text: string): void {
    const saved = decode(jsonValueWithin(SAVED_DEPTH), JSON.parse(text));
    const parsed = saved.ok ? parseWorkflowHandoffs(saved.value) : undefined;
    if (!saved.ok || !parsed) return;
    const open = this.openJobs();
    this.restoreChecklists(saved.value, open);
    for (const [jobId, bundle] of parsed.orchestrations) if (open.has(jobId)) this.sources.orchestrations.set(jobId, bundle);
    for (const [jobId, roles] of parsed.sessions) if (open.has(jobId)) this.sources.sessions.set(jobId, roles);
  }
}

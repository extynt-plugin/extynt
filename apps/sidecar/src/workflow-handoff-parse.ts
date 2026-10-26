// Reads the persisted specialist handoffs back: advisory context a restarted sidecar may show, never execution authority.

import { array, decode, type Decoder, jsonValue, literal, map, number, object, optional, record, string, union, type JsonValue } from "@extynt/decode";
import type { AgentMessage } from "@extynt/llm";
import { handoffDesign, handoffManifest } from "./workflow-handoff-scene.js";
import {
  specialistRole,
  WORKFLOW_OWNER,
  type WorkflowHandoffContract,
  type WorkflowOrchestrationBundle,
  type WorkflowSpecialistActivity,
  type WorkflowSpecialistBrief,
  type WorkflowSpecialistRole,
  type WorkflowSpecialistSession,
} from "./workflow-orchestration.js";

interface ParsedWorkflowHandoffs {
  readonly orchestrations: Map<string, WorkflowOrchestrationBundle>;
  readonly sessions: Map<string, Map<WorkflowSpecialistRole, WorkflowSpecialistSession>>;
}

type SessionFields = Omit<WorkflowSpecialistSession, "pending" | "controller">;

function list<T>(item: Decoder<T>): Decoder<T[]> {
  return map(array(item), (items) => [...items]);
}

const strings = list(string());

const brief: Decoder<WorkflowSpecialistBrief> = object({
  role: specialistRole,
  objective: string(),
  requirements: strings,
  deliverables: strings,
  constraints: strings,
  verification: strings,
  scene: optional(handoffManifest),
});

const activity: Decoder<WorkflowSpecialistActivity> = object({
  role: specialistRole,
  status: literal("running", "completed", "failed"),
  turn: number(),
  text: string(),
  reasoning: string(),
  updatedAt: string(),
  startedAt: optional(string()),
});

const unavailable: Decoder<WorkflowOrchestrationBundle["unavailable"][number]> = object({ role: specialistRole, reason: string() });

const contract: Decoder<WorkflowHandoffContract> = object({
  owner: literal(WORKFLOW_OWNER),
  sceneLayerManifest: strings,
  masksAndZOrder: strings,
  motionContinuity: strings,
  requirementChecklist: strings,
  verificationFramesAndEvidence: strings,
  executionStages: strings,
  requiredEvidenceKinds: list(literal("structural", "host_evidence", "visual", "temporal")),
  submissionPolicy: literal("orchestrator-only"),
});

const bundle: Decoder<WorkflowOrchestrationBundle> = object({
  owner: literal(WORKFLOW_OWNER),
  mode: literal("delegated", "partial", "single-agent-fallback"),
  specialists: list(brief),
  unavailable: list(unavailable),
  handoff: contract,
  activity: optional(list(activity)),
});

const message: Decoder<AgentMessage> = union(
  object({ role: literal("user", "assistant"), content: string() }),
  object({ role: literal("tool"), content: string(), toolCallId: string(), name: string() }),
);

const session: Decoder<SessionFields> = object({
  role: specialistRole,
  turns: number({ int: true }),
  messages: list(message),
  activity: optional(activity),
  brief: optional(brief),
  error: optional(string()),
  generation: optional(number()),
  ownerSeenTurn: optional(number()),
  ownerWokenTurn: optional(number()),
  design: optional(handoffDesign),
  target: optional(string()),
});

const skipped = map(jsonValue, (): undefined => undefined);

const envelope = object({
  version: literal(1),
  orchestrations: record(string(), union(bundle, skipped)),
  sessions: record(string(), union(record(string(), union(session, skipped)), map(jsonValue, () => ({})))),
});

function savedSession(fields: SessionFields): WorkflowSpecialistSession {
  const { error, target, ...rest } = fields;
  return { ...rest, ...(error ? { error } : {}), ...(target ? { target } : {}) };
}

function sessionsByRole(saved: Readonly<Record<string, SessionFields | undefined>>): Map<WorkflowSpecialistRole, WorkflowSpecialistSession> {
  const roles = new Map<WorkflowSpecialistRole, WorkflowSpecialistSession>();
  for (const [key, candidate] of Object.entries(saved)) {
    const role = decode(specialistRole, key);
    if (role.ok && candidate?.role === role.value) roles.set(role.value, savedSession(candidate));
  }
  return roles;
}

const workflowHandoffs: Decoder<ParsedWorkflowHandoffs> = map(envelope, (saved): ParsedWorkflowHandoffs => {
  const orchestrations = new Map<string, WorkflowOrchestrationBundle>();
  const sessions = new Map<string, Map<WorkflowSpecialistRole, WorkflowSpecialistSession>>();
  for (const [jobId, candidate] of Object.entries(saved.orchestrations)) if (candidate) orchestrations.set(jobId, candidate);
  for (const [jobId, candidate] of Object.entries(saved.sessions)) {
    const roles = sessionsByRole(candidate);
    if (roles.size) sessions.set(jobId, roles);
  }
  return { orchestrations, sessions };
});

/** The persisted handoffs for the state loader. */
export function parseWorkflowHandoffs(value: JsonValue | undefined): ParsedWorkflowHandoffs | undefined {
  const decoded = decode(workflowHandoffs, value);
  return decoded.ok ? decoded.value : undefined;
}

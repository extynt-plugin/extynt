// The shapes of one agent turn (its input, progress events and result), the plan card it produces, and the workflow tool names the sidecar recognises.
import type { JsonObject } from "@extynt/decode";
import type { AgentStepInput, AgentToolCall, AgentToolSpec, ChatMessage, ProviderImage, ReasoningEffort } from "@extynt/llm";
import type { callTool } from "@extynt/mcp-server";
import type { Translate } from "@extynt/ui-text";
import type { WorkflowOrchestrationSummary } from "./workflow-orchestration.js";

/** The arguments of one tool call, as the model wrote them. */
export type ToolArguments = { -readonly [Key in keyof AgentToolCall["arguments"]]: AgentToolCall["arguments"][Key] };

/** The payload a tool reports on success. */
export type ToolPayload = Extract<ReturnType<typeof callTool>, { ok: true }>["data"];

/** A failure the user can read: a stable code and a message. */
export interface AgentFailure { code: string; message: string }

interface AgentTokenUsage { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number }

/** A tool's answer: success or failure, its payload, and the extras the sidecar attaches (`sealedCard`, `autoApply`, `continuesLoop`, `embeddedSeals`, `workflowAdmissionRefusal`). */
export type ToolResult = { ok: boolean; error?: AgentFailure; data?: ToolPayload } & Record<string, ToolPayload>;

/** One classified disclosure on a plan card, with the operations it concerns. */
export interface AgentPlanNotice { severity: "note" | "unverified" | "error"; title: string; detail: string; because?: string; action?: string; operationIndexes?: number[]; code?: string; }

/** One change the plan makes, in plain words: what it is, the layer or composition it addresses, and the value before (null when unknown) and after. */
export interface AgentPlanRow { label: string; target?: string; before: string | null; after: string | null }

/**
 * A sealed plan as the panel shows it. `rows` repeats `operations` structured and is absent for a plan stored before value rows existed.
 * `notices` are classified disclosures, with `warnings` as the fallback. `expressions` are the expressions the plan will write.
 * `requiresAcknowledgement` is true when approval must acknowledge operations not verified on this AE build, and the panel never auto-applies those.
 * `autoApply` is the sidecar's decision: the panel may commit the card without a click only when it is true and the panel's own toggle is on.
 */
export interface AgentPlanCard { planId: string; title: string; operations: string[]; rows?: AgentPlanRow[]; warnings: string[]; notices?: AgentPlanNotice[]; expressions: Array<{ propertyPath: string; source: string }>; requiresAcknowledgement: boolean; autoApply: boolean; }

interface AgentToolTraceEntry { name: string; ok: boolean; code?: string | undefined; message?: string | undefined; }

interface AgentReasoningTraceEntry { step: number; text: string; tools: string[]; }

/** A live progress event. `wrappingUp` is set only near the step ceiling so an ordinary four-step turn never reads as "4 of 60"; `reasoning` is bounded because it rides a payload the panel polls about once a second. */
export interface AgentProgress { step: number; maxSteps: number; phase: "thinking" | "tool" | "retrying" | "note"; tool?: string; label: string; wrappingUp?: boolean; usage?: AgentTokenUsage; reasoning?: string; }

/** A long job that stopped at the automatic window cap and waits for the user's word to go on: `steps` is the authoring cycles it has run and `jobId` the job a Continue must resume. */
export interface WorkflowPause { kind: "window-cap"; steps: number; jobId: string }

/** How much of the step budget a woken loop still has: a wake that needs a few steps to act is pointless when the turn is about to wrap up. */
export interface FinalAnswerRoom { stepsLeft: number; wrapUp: number }

interface AgentQuestion { question: string; kind: "question" | "design-brief" }

interface AgentStepSummary { step: number; reasoning: string; tools: string[]; results: Array<{ name: string; ok: boolean; code?: string }> }

/** One sidecar log line for a finished tool call: the outcome, any failure, the bounded design and queue answers and the redacted arguments. */
export type AgentToolLogLine = { event: "agent.tool"; requestId: string; step: number; tool: string; ok: boolean; code?: string | undefined; message?: string | undefined; designResult?: string | undefined; queueAnswer?: AgentQueueAnswerLog | undefined; args: string };

/** A bounded benchmark event for an operation batch the queue refused: the error code, the repair attempt and the operation families only. */
export type AgentAdmissionLogLine = { event: "agent.admission_rejected"; requestId: string; step: number; tool: string; errorCode: string; repairAttempt: number; operationTypes: string[] };

type AgentProseLogLine = { event: "agent.prose"; requestId: string; step: number; finishReason?: string | undefined; chars: number; woken: boolean; text: string };

type AgentSpecialistLogLine = { event: "agent.specialist"; requestId: string; role: string; turn: number; outcome: string; reason: string | null; ms: number; inputTokens: number; outputTokens: number; steps: number };

type AgentSpecialistCallLogLine = JsonObject & { event: "specialist.call" };

/** What an accepted queue write reports to the log: the counts, the refusals still owed and the next step. */
export type AgentQueueAnswerLog = { queued?: number | undefined; accepted?: number | undefined; fix?: number | undefined; refusals?: string[] | undefined; outstanding?: number | undefined; next?: string | undefined };

/** Any line the turn writes to the sidecar log. */
export type AgentLogLine = AgentToolLogLine | AgentAdmissionLogLine | AgentProseLogLine | AgentSpecialistLogLine | AgentSpecialistCallLogLine;

/**
 * What one turn produced. `notes` has one entry per step that spoke before calling a tool, `reasoning` is what the provider exposed grouped with the tools chosen from that step, and `steering` holds the messages the user sent mid-turn in the order they landed.
 * `stopReason` is the provider's own stop signal for the last step that reported one. `usageReported` is true once any step carried provider-reported usage; false means the zeros in `usage` are unknown, not free.
 * `sealed` marks a bounded workflow cycle that stopped right after its first successful seal, `askedUser` the question the cycle ended on, and `mutated` that a seal under auto apply may already have changed the host.
 * `workflowCompletion` is the sidecar-owned completion proposal result and `workflowAdmissionRefusal` a sealed plan rejected before admission, which changed nothing and may be corrected.
 * `settledInLoop` marks a batch that settled clean inside the run with the model still going. `pause` is set when the turn ended at the automatic window cap and the panel should offer Continue for exactly that job.
 * `orchestration` is the sidecar-owned role and delegation record; specialists are advisory and only the owner may submit work.
 */
export interface AgentRunResult {
  outcome: "answered" | "planned" | "failed";
  notes: string[];
  answer: string;
  plans: AgentPlanCard[];
  tools: AgentToolTraceEntry[];
  reasoning: AgentReasoningTraceEntry[];
  steps: number;
  stopReason?: string;
  steering: string[];
  usage: AgentTokenUsage;
  usageReported?: boolean;
  failure?: AgentFailure;
  sealed?: boolean;
  askedUser?: AgentQuestion;
  mutated?: boolean;
  workflowCompletion?: { accepted: boolean; code?: string; message?: string };
  workflowAdmissionRefusal?: AgentFailure & { planId: string };
  settledInLoop?: boolean;
  pause?: WorkflowPause;
  orchestration?: WorkflowOrchestrationSummary;
}

/**
 * Everything `runAgent` needs for one turn. `briefingSegments` splits the briefing so a provider can cache the half that never changes, and `allowedTools` is an infrastructure-owned restriction that execution must enforce independently.
 * `wholeRead` means the turn holds a whole-project read, so the scoped graph-page tools are not offered. `autoApply` means the panel applies proposed plans without a click, so the reply must not point at an Apply button.
 * `image` is sent unless the model (or the user's own setting) takes no images, and `images` are further reference pictures for every step. `webSearch` is true only when the provider can serve a search itself.
 * `log` receives one line per tool call, redacted and truncated. `onStepDone` is called as each step finishes, so a cancelled turn keeps every completed step's reasoning. `takeSteering` is called before every model call, so a steer lands on the next step rather than aborting the call in flight.
 * `beforeFinalAnswer` may hold a premature prose answer until asynchronous collaborators settle, then inject a trusted wake message and continue the same owner loop. `signal` cancels the turn, which reports `CANCELLED` rather than a provider failure.
 * `liveState` is appended as its own uncached segment after the briefing, and `landingAt` (epoch ms) is when the model is told to land the turn. `stopAfterSeal` makes one model call propose one bounded batch and yield to receipts, and `stopAfterWorkflowCompletion` makes a sidecar-accepted typed completion terminal for the cycle.
 * `workflowStage` offers the in-panel handshake that selects one bounded stage, `workflowSpecialists` lets the owner call persistent read-only specialist threads, and `workflowChecklist` offers ae_workflow_checklist so the owner lists the whole request before it builds.
 * `withheldTools` names tools left out of the next provider step (re-read each step), `stepPolicy` is re-evaluated before every provider step so stage selection can change the next call's reasoning policy, `toolSpecs` is a caller-owned tool set that replaces the catalogue, and `forceStream` streams every step even when the provider's default is off.
 */
export interface AgentRunInput {
  requestId: string;
  message: string;
  history: readonly ChatMessage[];
  briefing: string;
  briefingSegments?: AgentStepInput["systemSegments"];
  allowedTools?: readonly string[];
  wholeRead?: boolean;
  callTool: (name: string, args: ToolArguments) => ToolResult | Promise<ToolResult>;
  providerName?: { displayName: string; keyVariable?: string };
  translate?: Translate;
  maxSteps?: number;
  toolBudgetTokens?: number;
  autoApply?: boolean;
  image?: ProviderImage;
  images?: ProviderImage[];
  webSearch?: boolean;
  log?: (line: AgentLogLine) => void;
  onProgress?: (progress: AgentProgress) => void;
  onStepDone?: (step: AgentStepSummary) => void;
  takeSteering?: () => string[];
  beforeFinalAnswer?: (room: FinalAnswerRoom) => Promise<string | undefined>;
  signal?: AbortSignal;
  liveState?: () => string | undefined;
  landingAt?: number;
  stopAfterSeal?: boolean;
  stopAfterWorkflowCompletion?: boolean;
  workflowStage?: boolean;
  workflowSpecialists?: boolean;
  workflowChecklist?: boolean;
  withheldTools?: () => readonly string[];
  stepPolicy?: () => { reasoningEffort?: ReasoningEffort };
  toolSpecs?: AgentToolSpec[];
  forceStream?: boolean;
}

/** The tool a model calls to select a bounded workflow stage; still accepted, no longer offered. */
export const WORKFLOW_STAGE_TOOL = "ae_select_workflow_stage";

/** The tool the workflow owner calls to ask the user one question and end the turn. */
export const WORKFLOW_ASK_TOOL = "ae_ask_user";

/** The tool the free-run owner calls to list the whole request before building. */
export const WORKFLOW_CHECKLIST_TOOL = "ae_workflow_checklist";

/** The tool the owner calls to close checklist items it tried and could not build. */
export const WORKFLOW_UNBUILT_TOOL = "ae_workflow_unbuilt";

/** The tool the owner calls to control a persistent specialist thread. */
export const WORKFLOW_SPECIALIST_TOOL = "ae_consult_specialist";

/** The tool the owner calls to queue the layers the visual-scene designer built. */
export const WORKFLOW_DESIGN_TOOL = "ae_queue_design";

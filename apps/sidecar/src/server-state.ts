// The sidecar's mutable state: one class that owns every field the capabilities share, composing the in-flight lane and the workflow handoff files.
import type { SidecarActionLedger } from "./server-workflow-sidecar-actions.js";
import { WorkflowRequestLog } from "./server-workflow-request-log.js";
import { AUTOMATIC_CYCLE_CEILING, type ProgressMark } from "./server-workflow-cycle-budget.js";
import { withChatModel } from "./decision-language.js";
import { jobDesignContext } from "./workflow-design-context.js";
import { SpecialistUsageLedger } from "./server-turn-usage.js";
import { NativeBridgeLease } from "./native-bridge-lease.js";
import { CollectionService } from "./collection-service.js";
import { fileDecisionLog } from "./decision-log.js";
import { LearnedAliases } from "./learned-aliases.js";
import { PreferenceTally } from "./preference-tally.js";
import { DecisionService } from "./decision-service.js";
import { EffectNotesService } from "./effect-notes-service.js";
import { EffectNotesSettings } from "./effect-notes-settings.js";
import { CatalogueCollector } from "./catalogue-collector.js";
import type { CatalogueEngine } from "./catalogue-engine.js";
import { ProjectGraphStore } from "./project-graph-store.js";
import { ChatProjectLinks } from "./chat-project-links.js";
import type { Server } from "node:http";

import { createDiagnosticSink, type DiagnosticSink } from "./diagnostics.js";
import type { ChatProvider } from "@extynt/llm";

import type { ModelSlot } from "./llm-config.js";
import type { StepUsage } from "./server-step-usage.js";

import type { ProjectSnapshot } from "@extynt/project-graph";
import type { FontSubstitution, VariantSet, StoredReceipt } from "@extynt/mcp-server";
import { SuggestionService } from "./suggestion-service.js";
import type { HostCapabilityProfile, Inventory } from "@extynt/capability-catalogue";

import { loadHostProfile, loadRuntimeEvidence, profileDirectory, type RuntimeEvidenceFile } from "./profile-store.js";
import { WorkflowCoordinator } from "./workflow-coordinator.js";
import type { HeldAnimation, HeldReleasedInto } from "./server-workflow-design-hold.js";
import type { WorkflowId } from "@extynt/workflow";
import { join } from "node:path";
import type { WorkflowOrchestrationBundle, WorkflowSpecialistRole, WorkflowSpecialistSession } from "./workflow-orchestration.js";
import { WorkflowHandoffs } from "./server-workflow-handoffs.js";
import { NativeFlight } from "./server-native-flight.js";
import { openWorkflowCoordinator } from "./server-workflow-coordinator-open.js";
import type { LogFields } from "./server-plan-log.js";
import type { CarriedRequest } from "./server-workflow-carry.js";
import { StampedPlanStore } from "./server-plan-store.js";
import { PlanLedger } from "./plan-ledger.js";
import type { LiveFocus } from "./live-focus.js";
import { offlineHostLink, type HostLink } from "./host/lane-types.js";
import { newHostFacts, type HostFacts } from "./host/facts.js";
import type { ReadScope } from "./read-queue.js";
import { freshSchedulerMemory, type LiveStamp, type SchedulerMemory } from "./read-scheduler.js";

import { APPROVAL_SWEEP_INTERVAL_MS, DEFAULT_MAX_BODY_BYTES, READY_PLAN_QUEUE_LIMIT } from "./server-limits.js";
import type { AgentMailboxItem, CaptureRecord, ChatAuthoringProgress, ChatProgress, InFlightItem, LineageLink, PanelState, SidecarOptions, StoredApprovalRecord, StoredSnapshot, WorkflowContinuationRun } from "./server-types.js";

const PLAN_LEDGER_BEAT_MS = 1500;

function boundedOption(configured: number | undefined, bounds: { min: number; max: number; fallback: number }): number {
  return configured !== undefined && Number.isInteger(configured) && configured >= bounds.min ? Math.min(bounds.max, configured) : bounds.fallback;
}

type ActiveChatTurn = { requestId: string; jobId?: string; clientGone?: boolean; detachable?: boolean; controller: AbortController; startedAt: number; settled: Promise<void> };

/** The single owner of every mutable sidecar field. */
export class SidecarState {
  readonly chatProjectLinks = new ChatProjectLinks();
  readonly collection: CollectionService;
  readonly decisions: DecisionService;
  readonly preferences: PreferenceTally;
  readonly aliases: LearnedAliases;
  readonly catalogue: CatalogueCollector;
  catalogueEngine: CatalogueEngine | undefined = undefined;
  userCensus: { census: Parameters<CatalogueCollector["onCensus"]>[0]; definitionsWritten: boolean } | undefined = undefined;
  eventLog: (event: string, fields: LogFields) => void = () => undefined;
  catalogueProbed: (hostKey: string, matchNames: readonly string[]) => void = () => undefined;
  readonly nativeBridge: NativeBridgeLease;
  readonly maxBodyBytes: number;
  readonly now: () => Date;
  readonly diagnostics: DiagnosticSink;
  server: Server | undefined;
  approvalSweep: ReturnType<typeof setInterval> | undefined;
  statusMemory: { requestId: string; value: string | null } | null = null;
  port: number | undefined;
  latest: StoredSnapshot | undefined;
  liveFocus: LiveFocus | null = null;
  liveStamp: LiveStamp | null = null;
  readScheduler: SchedulerMemory = freshSchedulerMemory();
  readSequence = 0;
  readonly issuedReads = new Map<string, ReadScope>();
  preflightCount = 0;
  snapshotPostCount = 0;
  previousInventory: Inventory | undefined;
  inventory: Inventory | undefined;
  hostProfile: HostCapabilityProfile | undefined;
  readonly receipts: StoredReceipt[] = [];
  readonly plans = new StampedPlanStore(() => this.latest?.snapshot.result.project);
  readonly planLedger: PlanLedger;
  private planLedgerTimer: ReturnType<typeof setInterval> | undefined;
  readonly variants = new Map<string, VariantSet>();
  readonly suggestions = new SuggestionService();
  readonly supersededProbes = new Set<string>();
  readonly reportedInterruptedApplies = new Set<string>();
  lastAgentCall: { at: string; client: string; tool: string } | null = null;
  chatProgress = new Map<string, ChatProgress>();
  closingReplies = new Map<string, string>();
  activeChatTurn: ActiveChatTurn | undefined;
  readonly workflowRuns = new Map<WorkflowId, WorkflowContinuationRun>();
  readonly workflowOrchestrations = new Map<WorkflowId, WorkflowOrchestrationBundle>();
  readonly specialistUsage = new SpecialistUsageLedger();
  readonly workflowSpecialistSessions = new Map<WorkflowId, Map<WorkflowSpecialistRole, WorkflowSpecialistSession>>();
  readonly workflowHeldAnimation = new Map<WorkflowId, HeldAnimation[]>();
  readonly workflowHeldReleasing = new Set<WorkflowId>();
  readonly workflowHeldReleasedInto = new Map<WorkflowId, HeldReleasedInto>();
  private readonly workflowHandoffs: WorkflowHandoffs;
  readonly autoResumedWorkflowJobs = new Set<WorkflowId>();
  readonly workflowCycleBudgetBase = new Map<WorkflowId, number>();
  readonly workflowProgressMarks = new Map<WorkflowId, ProgressMark>();
  readonly fontSubstitutions: FontSubstitution[] = [];
  readonly workflowSidecarActions = new Map<WorkflowId, SidecarActionLedger>();
  readonly workflowRequestLog: WorkflowRequestLog;
  readonly workflowContinuationQueue = new Set<WorkflowId>();
  workflowSchedulerRunning = false;
  chatSteering = new Map<string, string[]>();
  chatAuthoring: { requestId: string; progress: ChatAuthoringProgress } | null = null;
  chatSettleWaitMs = 0;
  chatStepUsage: (StepUsage & { requestId: string }) | null = null;
  pendingJobUndo: { jobId: string; order: Array<{ planId: string; times: number; groups: number; undoGroup: string; expectedFingerprint: string | null }>; cursor: number } | null = null;
  readyPlans: Array<{ planId: string; batch: number; jobId: string | null; jobBatch: number | null; operations: number; undoGroups: number; completedAt: string; deliveredAt: string | null; requestId: string | null; autoApply: boolean }> = [];
  readonly reviewHeldRequests = new Set<string>();
  readyPlanSequence = 0;
  openQueuePlanId: string | null = null;
  externalQueuePlanId: string | null = null;
  get readyPlanQueueLimit(): number {
    return boundedOption(this.options.readyPlanQueueLimit, { min: 1, max: 1024, fallback: READY_PLAN_QUEUE_LIMIT });
  }

  get workflowMaxCycles(): number {
    return boundedOption(this.options.workflowMaxCycles, { min: 1, max: 16, fallback: 16 });
  }

  get workflowCycleCeiling(): number {
    return boundedOption(this.options.workflowCycleCeiling, { min: 1, max: AUTOMATIC_CYCLE_CEILING, fallback: AUTOMATIC_CYCLE_CEILING });
  }

  get approvalSweepMs(): number {
    return boundedOption(this.options.approvalSweepMs, { min: 20, max: 60_000, fallback: APPROVAL_SWEEP_INTERVAL_MS });
  }
  get panelSnapshotWaitMs(): number {
    return boundedOption(this.options.panelSnapshotWaitMs, { min: 0, max: 8000, fallback: 8000 });
  }
  settledBatchIds: Record<string, string> = {};
  chatProvider: ChatProvider | undefined;
  fallbackChatProvider: ChatProvider | undefined;
  modelKeyVariables: Partial<Record<ModelSlot, string>> = {};
  modelSettingsErrors: string[] = [];
  readonly approvalRecords = new Map<string, StoredApprovalRecord>();
  readonly agentMailbox: AgentMailboxItem[] = [];
  readonly changeWaiters = new Set<() => void>();
  hostLink: HostLink;
  readonly hostFacts: HostFacts = newHostFacts();
  hostWake: () => void = () => undefined;
  readonly captures = new Map<string, CaptureRecord>();
  activePanelInstanceId: string | undefined;
  panelBuild: string | null = null;
  shutdownRequested: { panelInstanceId: string; requestedAt: string; reason: "cep-host-closing" } | null = null;
  awaitingFreshSnapshotAfterPair = false;
  pendingPanelReset = false;
  panel: PanelState = { lastSeenAt: 0, busy: false, busyKind: null, busySinceAt: null, lastError: null };
  panelIdleSince: number | null = null;
  private readonly flight = new NativeFlight();
  releaseNativeFlight(id: string): void {
    this.flight.release(id);
  }
  get inFlight(): InFlightItem | undefined {
    return this.flight.current;
  }
  set inFlight(value: InFlightItem | undefined) {
    this.flight.current = value;
  }
  readonly lineage = new Map<string, LineageLink>();
  normalizedCache: { source: StoredSnapshot; value: ProjectSnapshot } | undefined;
  preApply: { planId: string; snapshot: ProjectSnapshot } | undefined;
  latestInterruptedApply: { planId: string; index: number; operationCount: number | null; operation: string | null; layerId: string | null; startedAt: string | null } | null = null;
  readonly runtimeEvidence: RuntimeEvidenceFile;
  readonly workflowCoordinator: WorkflowCoordinator;
  readonly carriedRequests = new Map<string, CarriedRequest>();
  readonly designApprovals = new Map<string, "requested" | "approved">();

  public constructor(public readonly options: SidecarOptions) {
    this.chatProvider = options.chatProvider;
    this.fallbackChatProvider = options.fallbackChatProvider;
    if (!options.token) throw new Error("A non-empty session token is required.");
    this.maxBodyBytes = boundedOption(options.maxBodyBytes, { min: 1024, max: Number.MAX_SAFE_INTEGER, fallback: DEFAULT_MAX_BODY_BYTES });
    this.now = options.now ?? (() => new Date());
    this.hostLink = offlineHostLink(this.now().getTime());
    this.workflowCoordinator = openWorkflowCoordinator(options, this.now);
    this.workflowCoordinator.blockInterruptedActiveJob();
    this.workflowCoordinator.abandonStaleApprovalJob();
    this.workflowCoordinator.bindDesignContext((jobId) => jobDesignContext(this, jobId));
    this.workflowCoordinator.onClose(() => this.flushWorkflowHandoffs());
    const directory = options.stateDirectory ?? profileDirectory();
    const graph = new ProjectGraphStore(directory), clock = () => this.now().getTime();
    this.collection = new CollectionService(clock, graph, new EffectNotesService({ graph, settings: new EffectNotesSettings(directory), now: clock }));
    this.catalogue = new CatalogueCollector({ directory, enabled: options.catalogueProbe === true, now: () => this.now().getTime(), store: { probedKeys: (hostKey) => this.collection.catalogueProbedKeys(hostKey), writeProbe: (inputs) => this.collection.writeCatalogueProbe(inputs), writeInstance: (input) => this.collection.writeCatalogueInstance(input) },
      log: (event, fields) => this.eventLog(event, fields), onProbed: (hostKey, matchNames) => this.catalogueProbed(hostKey, matchNames) });
    this.decisions = new DecisionService({ models: withChatModel(options.decisionModels ?? (() => []), () => this.chatProvider, process.env), log: fileDecisionLog(directory), now: this.now, usage: this.specialistUsage });
    this.preferences = new PreferenceTally(directory, clock, () => this.collection.effectNotes.learnFromWork());
    this.aliases = new LearnedAliases(directory, () => this.collection.effectNotes.learnFromWork());
    this.nativeBridge = new NativeBridgeLease(directory);
    this.workflowHandoffs = new WorkflowHandoffs(join(directory, "workflow-handoffs.json"), { orchestrations: this.workflowOrchestrations, sessions: this.workflowSpecialistSessions, actions: this.workflowSidecarActions, coordinator: this.workflowCoordinator });
    this.workflowRequestLog = new WorkflowRequestLog(options.workflowStore ? undefined : join(directory, "workflow-requests"));
    this.workflowHandoffs.restore();
    for (const record of this.workflowCoordinator.recoveredPlans()) this.plans.set(record.plan.planId, record);
    this.planLedger = new PlanLedger(directory, this.now);
    this.planLedger.startup(new Set(this.plans.keys()));
    this.planLedger.sync(this.plans);
    this.planLedgerTimer = setInterval(() => this.planLedger.sync(this.plans), PLAN_LEDGER_BEAT_MS);
    this.planLedgerTimer.unref();
    this.workflowCoordinator.onClose(() => { clearInterval(this.planLedgerTimer); this.planLedger.sync(this.plans); });
    this.diagnostics = createDiagnosticSink(options.diagnostics);
    this.hostProfile = loadHostProfile(directory);
    this.runtimeEvidence = loadRuntimeEvidence(directory);
  }

  public get latestSnapshot(): StoredSnapshot | undefined {
    return this.latest;
  }

  public persistWorkflowHandoffs(): void {
    this.workflowHandoffs.persist();
  }

  public flushWorkflowHandoffs(): void {
    this.workflowHandoffs.flush();
  }
}

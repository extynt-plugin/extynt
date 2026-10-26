// The Sidecar server: the HTTP state holder with its composed capabilities, and the public surface the rest of the app imports.

import { SidecarState } from "./server-state.js";
import type { SidecarOptions } from "./server-types.js";

import { createHttpCore, type HttpCoreCapability } from "./server-http-core.js";
import { createPlanState, type PlanStateCapability } from "./server-plan-state.js";
import { createPlanView, type PlanViewCapability } from "./server-plan-view.js";
import { createPlanLog, type PlanLogCapability } from "./server-plan-log.js";
import { createWorkflowProgress, type WorkflowProgressCapability } from "./server-workflow-progress.js";
import { createApplyAdmission, type ApplyAdmissionCapability } from "./server-apply-admission.js";
import { createApplyRuntime, type ApplyRuntimeCapability } from "./server-apply-runtime.js";
import { createChatSupport, type ChatSupportCapability } from "./server-chat-support.js";
import { createWorkflowAdmission, type WorkflowAdmissionCapability } from "./server-workflow-admission.js";
import { createFocus, type FocusCapability } from "./server-focus.js";
import { createMcpDelivery, type McpDeliveryCapability } from "./server-mcp-delivery.js";
import { createChatAgent } from "./server-chat-agent.js";
import type { ChatAgentCapability } from "./server-chat-agent-types.js";
import { createWorkflowContinuation, type WorkflowContinuationCapability } from "./server-workflow-continuation.js";
import { createWorkflowCycles, type WorkflowCyclesCapability } from "./server-workflow-cycles.js";
import { createRuntime, type RuntimeCapability } from "./server-runtime.js";
import { createJobUndo, type JobUndoCapability } from "./server-job-undo.js";
import { createMcpTools, type McpToolsCapability } from "./server-mcp-tools.js";
import { createPanelLease, type PanelLeaseCapability } from "./server-panel-lease.js";
import { createPanelEvents, type PanelEventsCapability } from "./server-panel-events.js";
import { createReceipts, type ReceiptsCapability } from "./server-receipts.js";
import { createChatRoute, type ChatRouteCapability } from "./server-chat-route.js";
import { createHttpRoutes } from "./server-http-routes.js";
import type { HttpRoutesCapability } from "./server-http-state.js";
import { refreshProfileFromCatalogue } from "./catalogue-profile.js";
import { createNativeHost, type NativeHost } from "./host/native-host.js";
import { CatalogueEngine } from "./catalogue-engine.js";
import { acceptEngineCensus } from "./server-engine-census.js";
import { ENGINE_DISCOVERY_FILE, engineApplications, engineDiscoveryPid, installedEngineHosts, reapLeftoverEngines } from "./catalogue-engine-process.js";
import { defaultDiscoveryPath } from "@extynt/host-native";
import { profileDirectory } from "./profile-store.js";
import { dirname, join } from "node:path";

export type SidecarCapabilities =
  & ApplyAdmissionCapability
  & ApplyRuntimeCapability
  & ChatAgentCapability
  & ChatRouteCapability
  & ChatSupportCapability
  & FocusCapability
  & HttpCoreCapability
  & HttpRoutesCapability
  & JobUndoCapability
  & McpDeliveryCapability
  & McpToolsCapability
  & PanelEventsCapability
  & PanelLeaseCapability
  & PlanLogCapability
  & PlanStateCapability
  & PlanViewCapability
  & ReceiptsCapability
  & RuntimeCapability
  & WorkflowAdmissionCapability
  & WorkflowContinuationCapability
  & WorkflowCyclesCapability
  & WorkflowProgressCapability;

export interface ReadOnlySidecar extends SidecarCapabilities {}

export class ReadOnlySidecar extends SidecarState {
  public constructor(options: SidecarOptions) {
    super(options);
    const capabilities = composeCapabilities(this);
    Object.assign(this, capabilities);
    this.eventLog = (event, fields) => capabilities.logPlanEvent(event, fields);
    this.catalogueProbed = (hostKey, matchNames) => refreshProfileFromCatalogue(this, hostKey, matchNames);
    this.hostProfile = capabilities.withEffectEvidence(this.hostProfile);
    if (options.modelSettings) capabilities.reloadModelProviders();
    this.nativeHost = this.startsWithNativeHost(capabilities);
  }

  public nativeHost: NativeHost | undefined;

  private startsWithNativeHost(capabilities: SidecarCapabilities): NativeHost {
    const host = createNativeHost({
      state: this, receivers: capabilities.receivers, claims: capabilities, current: () => capabilities.normalizedLatest(), notifyChange: () => capabilities.notifyChange(), wakeContinuations: () => capabilities.wakeDeferredWorkflowContinuations(),
      approve: (planId, source) => capabilities.approvePlanInProcess(planId, source),
    });
    this.catalogueEngine = this.createCatalogueEngine();
    const start = capabilities.start, stop = capabilities.stop;
    this.start = async () => { const address = await start(); host.start(); return address; };
    this.stop = async () => { this.catalogueEngine?.stop(); host.stop(); await stop(); };
    return host;
  }

  private createCatalogueEngine(): CatalogueEngine {
    const discovery = this.options.discoveryPath ?? defaultDiscoveryPath();
    const logPath = join(this.options.stateDirectory ?? profileDirectory(), "catalogue-engine.log");
    const hosts = (): ReturnType<typeof installedEngineHosts> => installedEngineHosts(engineApplications());
    const engineDiscovery = join(dirname(discovery), ENGINE_DISCOVERY_FILE);
    const reaped = reapLeftoverEngines(hosts(), undefined, undefined, engineDiscoveryPid(engineDiscovery));
    if (reaped > 0) this.eventLog("catalogue.engine-reaped", { count: reaped });
    return new CatalogueEngine({
      catalogue: this.catalogue,
      acceptCensus: (census) => Promise.resolve(acceptEngineCensus(this, census)),
      log: (event, fields) => this.eventLog(event, fields),
      now: () => this.now().getTime(),
      discoveryPath: engineDiscovery,
      logPath,
      hosts,
      finished: () => { if (this.userCensus) this.catalogue.onCensus(this.userCensus.census, this.userCensus.definitionsWritten); },
    });
  }
}

function composeCore(sidecar: ReadOnlySidecar) {
  const state: SidecarState = sidecar;
  const transport = createHttpCore({ state });
  const planState = createPlanState({ state });
  const planLog = createPlanLog({ state });
  const workflowProgress = createWorkflowProgress({ state });
  const applyAdmission = createApplyAdmission({ state, planState });
  const planView = createPlanView({ state, planState, panelSessionId: () => applyAdmission.panelSessionId() });
  const applyRuntime = createApplyRuntime({ state, planState, planLog, transport });
  const chatSupport = createChatSupport({ state, planState, planView, transport });
  const workflowAdmission = createWorkflowAdmission({ state, planState, planView, planLog, transport });
  const focus = createFocus({ state, planState, transport });
  const delivery = createMcpDelivery({ state, applyAdmission, planLog, planState, planView, transport });
  const chatAgent = createChatAgent({ state, applyRuntime, chatSupport, delivery, focus, planLog, planState, planView, transport, workflowAdmission });
  return { state, transport, planState, planLog, workflowProgress, applyAdmission, planView, applyRuntime, chatSupport, workflowAdmission, focus, delivery, chatAgent };
}

type Core = ReturnType<typeof composeCore>;

function composeCycles({ state, chatAgent, planState, transport, workflowProgress }: Core) {
  let cycles: WorkflowCyclesCapability | undefined;
  const continuation = createWorkflowContinuation({
    state,
    planState,
    workflowProgress,
    runWorkflowCycles: (primary, fallback, turn, run) => {
      if (!cycles) throw new Error("workflow cycles were used before composition completed");
      return cycles.runWorkflowCycles(primary, fallback, turn, run);
    },
  });
  cycles = createWorkflowCycles({ state, chatAgent, continuation, planState, transport, workflowProgress });
  return { continuation, cycles };
}

function composeServing(sidecar: ReadOnlySidecar, core: Core, workflow: ReturnType<typeof composeCycles>) {
  const { state, applyAdmission, chatSupport, delivery, focus, planLog, planState, planView, transport } = core;
  const { continuation, cycles } = workflow;
  const runtime = createRuntime({ state, planState, planView, planLog, transport, continuation });
  const jobUndo = createJobUndo({ state, planState });
  const mcpTools = createMcpTools({ state, applyAdmission, chatSupport, continuation, cycles, delivery, focus, planLog, planState, planView, runtime, transport });
  const panelLease = createPanelLease({ state, applyAdmission, planLog, planState, runtime, transport });
  const panelEvents = createPanelEvents({ state, planState, planLog, transport });
  const receipts = createReceipts({ state, jobUndo, planLog, planState, runtime, transport });
  const chatRoute = createChatRoute({ state, continuation });
  const httpRoutes = createHttpRoutes({ state, dispatch: sidecar });
  return { runtime, jobUndo, mcpTools, panelLease, panelEvents, receipts, chatRoute, httpRoutes };
}

function composeCapabilities(sidecar: ReadOnlySidecar): SidecarCapabilities {
  const core = composeCore(sidecar);
  const workflow = composeCycles(core);
  const serving = composeServing(sidecar, core, workflow);
  return {
    ...core.transport,
    ...core.planState,
    ...core.planLog,
    ...core.workflowProgress,
    ...core.applyAdmission,
    ...core.planView,
    ...core.applyRuntime,
    ...core.chatSupport,
    ...core.focus,
    ...core.workflowAdmission,
    ...core.delivery,
    ...core.chatAgent,
    ...workflow.continuation,
    ...workflow.cycles,
    ...serving.runtime,
    ...serving.jobUndo,
    ...serving.mcpTools,
    ...serving.panelLease,
    ...serving.panelEvents,
    ...serving.receipts,
    ...serving.chatRoute,
    ...serving.httpRoutes,
  };
}

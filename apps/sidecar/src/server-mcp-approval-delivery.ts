// An approval bound to the command the paired panel will run, and queued for it in the agent mailbox.
import { computePlanDigest, type ActionPlan } from "@extynt/action-plan";
import type { HostPlanCommand } from "@extynt/host-ae";
import { decode, object, string } from "@extynt/decode";
import { jsonOf, type StoredPlan } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { enqueueHostWork, type HostWorkQueueState } from "./host/work-queue.js";
import { isDataFields, type DataFields } from "./server-mcp-data.js";
import type { McpDeliveryDeps } from "./server-mcp-delivery-deps.js";
import type { McpSuccess } from "./server-mcp-result.js";
import { approvalReference } from "./server-build.js";
import type { WorkflowCoordinator } from "./workflow-coordinator.js";

type MailboxAttachment = { readonly queued: true } | { readonly ok: false; readonly code: string; readonly message: string };

type ApprovalRefusal = Extract<MailboxAttachment, { ok: false }>;
type Executable = { plan: ActionPlan; command: HostPlanCommand };

/** The approval members of the delivery capability: every queued approval carries the compiled host command, and the response itself carries only the acknowledgement. */
export interface ApprovalDeliveryCapability {
  attachMailboxCommand(result: McpSuccess, record: StoredPlan, snapshot: ProjectSnapshot): MailboxAttachment;
}

const approvalOnly = object({ plan: object({}), approval: object({ token: string(), panelSessionId: string() }) });

function bindWorkflowApproval(input: { coordinator: WorkflowCoordinator; record: StoredPlan; token: string; rebasedOver: string[] | undefined }): ApprovalRefusal | undefined {
  const { coordinator, record, token, rebasedOver } = input;
  if (!coordinator.hasPlan(record.plan.planId)) return undefined;
  if (rebasedOver) return { ok: false, code: "WORKFLOW_REBASE_REFUSED", message: "workflow-v1 refuses rebased approval; prepare a new sealed plan against the current snapshot." };
  try {
    coordinator.bindApproval(record.plan.planId, approvalReference(token), record.plan.snapshotFingerprint, computePlanDigest(record.plan));
    return undefined;
  } catch (error) {
    return { ok: false, code: "WORKFLOW_APPROVAL_REFUSED", message: error instanceof Error ? error.message : String(error) };
  }
}

function enqueueApproval(state: HostWorkQueueState, data: DataFields, executable: Executable): MailboxAttachment {
  enqueueHostWork(state, { planId: executable.plan.planId, approvedData: { ...data, command: jsonOf(executable.command) } });
  delete data.command;
  delete data.plan;
  data.mailbox = { queued: true, automaticApply: "The host lane claims and applies this command.", ...(executable.plan.digest === undefined ? {} : { digest: executable.plan.digest }) };
  return { queued: true };
}

function adoptRebase(input: { record: StoredPlan; data: DataFields; plan: ActionPlan; rebasedOver: string[] }): void {
  const { record, data, plan, rebasedOver } = input;
  record.plan = plan;
  record.rebasedOver = rebasedOver;
  data.plan = jsonOf(plan);
  data.rebased = { overPlans: rebasedOver };
}

/** The approval members of the delivery capability, over the executable commands the apply admission compiles. */
export function createApprovalDelivery(deps: McpDeliveryDeps): ApprovalDeliveryCapability {
  return {
    attachMailboxCommand(result: McpSuccess, record: StoredPlan, snapshot: ProjectSnapshot): MailboxAttachment {
      const data = result.data;
      const bound = decode(approvalOnly, data);
      if (!bound.ok || !isDataFields(data)) return { ok: false, code: "APPROVAL_UNAVAILABLE", message: "The approval could not be bound to an executable command." };
      const { token, panelSessionId } = bound.value.approval;
      const executable = deps.applyAdmission.executableFor(record, snapshot, token, panelSessionId);
      if ("code" in executable) return executable;
      const refusal = bindWorkflowApproval({ coordinator: deps.state.workflowCoordinator, record, token, rebasedOver: executable.rebasedOver });
      if (refusal) return refusal;
      const fields: DataFields = data;
      if (executable.rebasedOver) adoptRebase({ record, data: fields, plan: executable.plan, rebasedOver: executable.rebasedOver });
      fields.command = jsonOf(executable.command);
      return enqueueApproval(deps.state, fields, executable);
    },
  };
}

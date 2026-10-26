/**
 * Routes the parameter tool of each transport into the plan authoring that transport already has: the external MCP server
 * proposes through `ae_propose_plan`, the panel's chat through its queue. A rejected or half-recorded proposal rolls back the
 * newly authored, unapproved plan; native execution is never touched.
 */
import { callTool, jsonOf, type ToolContext } from '@extynt/mcp-server';
import type { PreparedParameterChange } from './relational-types.js';
import { runRelationalTool, type RelationalToolDeps } from './relational-tools.js';
import { isRow, type Row } from './snapshot-view.js';

type ToolResult = ReturnType<typeof callTool>;
type RoutedDeps = Pick<RelationalToolDeps, 'collection' | 'snapshot' | 'panelInstanceId' | 'now'>;
type PanelRoutedDeps = RoutedDeps & { queuedPlanId(): string };
type QueueCall = (args: Row) => Promise<ToolResult>;
function emptySubmission(code: string, message: string): Awaited<ReturnType<RelationalToolDeps['submitChange']>> {
  return { result: { ok: false, error: { code, message } }, planId: '', markDesired() { return false; }, rollback() {} };
}
function planIdentity(result: ToolResult, queuedPlanId?: () => string): string {
  if (queuedPlanId) return queuedPlanId();
  return result.ok && isRow(result.data) && typeof result.data.planId === 'string' ? result.data.planId : '';
}
async function submit(change: PreparedParameterChange, context: ToolContext, author: QueueCall, queuedPlanId?: () => string): Promise<Awaited<ReturnType<RelationalToolDeps['submitChange']>>> {
  if (queuedPlanId && context.queue?.planId) return emptySubmission('PARAMETER_QUEUE_NOT_EMPTY', 'Finish or discard the existing queue before preparing this single-read-set parameter assignment.');
  const result = await author({ summary: change.summary, operations: jsonOf(change.operations) });
  const planId = planIdentity(result, queuedPlanId);
  return { result, planId, markDesired() {
    const record = context.plans?.get(planId);
    if (!record || !['draft', 'prepared', 'presented'].includes(record.status)) return false;
    record.relationalParameter = { controlInstanceId: change.desired.controlInstanceId, sourceObservationId: change.desired.sourceObservationId };
    return true;
  }, rollback() {
    const record = context.plans?.get(planId);
    if (record && ['draft', 'prepared', 'presented'].includes(record.status)) context.plans?.delete(planId);
    if (queuedPlanId?.() === planId) context.queue?.set(null);
  } };
}
/** The parameter tool for the external MCP server: the change is proposed through `ae_propose_plan`. */
export async function runExternalParameterTool(deps: RoutedDeps, args: Row, context: ToolContext): Promise<ToolResult> {
  return runRelationalTool({ ...deps, submitChange: change => submit(change, context, async authored => callTool('ae_propose_plan', authored, context)) }, 'ae_prepare_parameter_change', args);
}
/** The parameter tool for the panel: the change joins the queue the panel is building. */
export async function runPanelParameterTool(deps: PanelRoutedDeps, args: Row, context: ToolContext, queue: QueueCall): Promise<ToolResult> {
  return runRelationalTool({ ...deps, submitChange: change => submit(change, context, queue, deps.queuedPlanId) }, 'ae_prepare_parameter_change', args);
}

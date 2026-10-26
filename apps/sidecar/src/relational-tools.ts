/**
 * Runs the relational tools of both transports (the external MCP server and the panel's chat) through one typed parser and
 * one admission path: the query tools read the retained graph, and the parameter tool prepares a plan that waits for approval.
 */
import type { ProjectSnapshot } from '@extynt/project-graph';
import type { callTool } from '@extynt/mcp-server';
import { parseControlDescription, parseParameterChange, parseRelationalQuery } from './relational-arguments.js';
import { prepareParameterChange } from './relational-parameter.js';
import type { PreparedParameterChange, RelationalQuery } from './relational-types.js';
import { isRow, type Row } from './snapshot-view.js';

type ToolResult = ReturnType<typeof callTool>;
const PREPARE_TOOL = 'ae_prepare_parameter_change';
/** The tools that only read the retained graph. */
export const RELATIONAL_QUERY_TOOLS = new Set(['ae_query_relational_graph', 'ae_describe_control']);
/** What the tools read from the sidecar. The caller chooses the existing authorized proposal and queue path in `submitChange`; it cannot execute. */
export interface RelationalToolDeps {
  collection: {
    queryRelational(query: RelationalQuery): Row;
    resolveParameter(input: { controlInstanceId: number; observationId: string }): Row;
    invalidateDesired(planId: string): Row;
    recordDesiredParameter(input: { planId: string; controlInstanceId: number; sourceObservationId: string; value: number }): Row;
  };
  snapshot: ProjectSnapshot | undefined;
  panelInstanceId: string | undefined;
  now: number;
  submitChange(change: PreparedParameterChange): Promise<{ result: ToolResult; planId: string; markDesired(): boolean; rollback(): void }>;
}
function toolFailure(code: string, message: string): ToolResult { return { ok: false, error: { code, message } }; }
function queryResult(deps: RelationalToolDeps, name: string, args: Row): ToolResult {
  const parsed = name === 'ae_describe_control' ? parseControlDescription(args) : parseRelationalQuery(args);
  if ('error' in parsed) return parsed;
  return { ok: true, tool: name, snapshotFingerprint: deps.snapshot?.fingerprint ?? null, data: deps.collection.queryRelational(parsed.value) };
}
function desiredWasRetained(result: Row): boolean { return result.ok === true || result.state === 'prepared'; }
type Submitted = Awaited<ReturnType<RelationalToolDeps['submitChange']>>;
const NEXT_STEP = 'Use the existing plan approval or queue finish flow. A SQL desired request proves no AE mutation.';
function retainDesired(deps: RelationalToolDeps, submitted: Submitted, prepared: PreparedParameterChange): ToolResult | undefined {
  if (!submitted.planId) { submitted.rollback(); return toolFailure('PARAMETER_AUTHORING_UNAVAILABLE', 'The existing authoring path returned no internal plan identity; the parameter proposal was rolled back.'); }
  let retained: Row;
  try { retained = deps.collection.recordDesiredParameter({ planId: submitted.planId, ...prepared.desired }); }
  catch { submitted.rollback(); return toolFailure('PARAMETER_DESIRED_STORAGE_UNAVAILABLE', 'The separate desired request could not be retained; the parameter proposal was rolled back.'); }
  if (!desiredWasRetained(retained)) { submitted.rollback(); return toolFailure('PARAMETER_DESIRED_STORAGE_UNAVAILABLE', 'The exact source observation was no longer current; the parameter proposal was rolled back.'); }
  if (!submitted.markDesired()) { deps.collection.invalidateDesired(submitted.planId); submitted.rollback(); return toolFailure('PARAMETER_AUTHORING_UNAVAILABLE', 'The newly authored plan was no longer available for exact desired tracking; the proposal was rolled back.'); }
  if (submitted.result.ok && isRow(submitted.result.data)) Object.assign(submitted.result.data, { parameterRequest: retained, sourceObservationId: prepared.desired.sourceObservationId, writeAuthorizing: false, next: NEXT_STEP });
  return undefined;
}
async function prepareResult(deps: RelationalToolDeps, name: string, args: Row): Promise<ToolResult> {
  const parsed = parseParameterChange(args);
  if ('error' in parsed) return parsed;
  const current = deps.collection.resolveParameter(parsed.value);
  const prepared = prepareParameterChange({ request: parsed.value, current, snapshot: deps.snapshot, panelInstanceId: deps.panelInstanceId, now: deps.now });
  if (!prepared.ok) return prepared;
  const submitted = await deps.submitChange(prepared);
  if (!submitted.result.ok) return submitted.result;
  return retainDesired(deps, submitted, prepared) ?? { ...submitted.result, tool: name };
}
/** Both transports share one typed domain parser and admission path. */
export async function runRelationalTool(deps: RelationalToolDeps, name: string, args: Row): Promise<ToolResult> {
  try {
    if (RELATIONAL_QUERY_TOOLS.has(name)) return queryResult(deps, name, args);
    if (name === PREPARE_TOOL) return await prepareResult(deps, name, args);
    return toolFailure('UNKNOWN_RELATIONAL_TOOL', 'No typed relational tool exists under this name.');
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message) ? error.message : 'RELATIONAL_TOOL_UNAVAILABLE';
    return toolFailure(code, 'Typed relational evidence is unavailable; no native work was authorized.');
  }
}

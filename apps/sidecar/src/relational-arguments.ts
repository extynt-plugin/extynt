/**
 * Parses the arguments of the relational tools into typed requests: the relational queries, the control description and the
 * parameter change. Anything outside the exact shape is refused with an INVALID_RELATIONAL_ARGUMENT failure.
 */
import { isRow, type Opaque, type Row } from './snapshot-view.js';
import type { ParameterChangeFailure, ParameterChangeRequest, RelationalQuery } from './relational-types.js';

type Parsed<T> = { value: T } | ParameterChangeFailure;
function refusal(message: string): ParameterChangeFailure { return { ok: false, error: { code: 'INVALID_RELATIONAL_ARGUMENT', message } }; }
function text(value: Opaque, maximum = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum; }
function ordinal(value: Opaque): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function keys(value: Row, allowed: readonly string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function transportWait(value: Opaque): boolean { return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 60); }
function optionalText(value: Opaque, maximum = 256): boolean { return value === undefined || text(value, maximum); }
function pageFields(value: Row): boolean { return optionalText(value.cursor) && (value.limit === undefined || (ordinal(value.limit) && value.limit <= 25)); }
function parameterEnvelope(args: Row): boolean {
  return keys(args, ['controlInstanceId', 'observationId', 'value', 'summary', 'waitSeconds']) && transportWait(args.waitSeconds) && ordinal(args.controlInstanceId) && text(args.observationId, 128) && optionalText(args.summary, 512);
}
function parameterValue(value: Opaque): value is Row & { kind: 'number'; value: number } {
  return isRow(value) && keys(value, ['kind', 'value', 'unit']) && value.kind === 'number' && typeof value.value === 'number' && Number.isFinite(value.value) && optionalText(value.unit, 64);
}
/** The parameter change a tool call asks for, when its arguments have exactly the typed shape. */
export function parseParameterChange(args: Row): Parsed<ParameterChangeRequest> {
  if (!parameterEnvelope(args)) return refusal('A parameter change needs an exact controlInstanceId, observationId, typed value and optional summary.');
  const value = args.value;
  if (!parameterValue(value)) return refusal('value must be {kind:"number",value:<finite native number>,unit?:<exact native unit>}; conversions, animation and expressions are unavailable.');
  return { value: { controlInstanceId: Number(args.controlInstanceId), observationId: String(args.observationId), value: { kind: 'number', value: value.value, ...(value.unit === undefined ? {} : { unit: String(value.unit) }) }, ...(args.summary === undefined ? {} : { summary: String(args.summary) }) } };
}
function effectQuery(query: Row): Parsed<RelationalQuery> {
  if (!text(query.hostKey) || !optionalText(query.matchName) || !keys(query, ['kind', 'hostKey', 'matchName', 'cursor', 'limit'])) return refusal('Effect definition queries need an exact hostKey and optional exact matchName.');
  return { value: { kind: 'effect-definitions', hostKey: query.hostKey, ...(query.matchName === undefined ? {} : { matchName: String(query.matchName) }) } };
}
function parameterQuery(query: Row): Parsed<RelationalQuery> {
  if (!text(query.effectDefinitionId) || !keys(query, ['kind', 'effectDefinitionId', 'cursor', 'limit'])) return refusal('Parameter definitions require an exact effectDefinitionId.');
  return { value: { kind: 'parameter-definitions', effectDefinitionId: query.effectDefinitionId } };
}
function factQuery(query: Row): Parsed<RelationalQuery> {
  if (!text(query.parameterDefinitionId) || !keys(query, ['kind', 'parameterDefinitionId', 'cursor', 'limit'])) return refusal('Parameter facts require an exact parameterDefinitionId.');
  return { value: { kind: 'parameter-facts', parameterDefinitionId: query.parameterDefinitionId } };
}
function controlFilters(query: Row): boolean {
  return optionalText(query.effectMatchName) && optionalText(query.controlMatchName) && (query.effectIndex === undefined || ordinal(query.effectIndex));
}
function controlQuery(query: Row): Parsed<RelationalQuery> {
  if (!text(query.compositionId, 128) || !text(query.layerId, 128)) return refusal('Current control queries require compositionId and layerId.');
  if (!keys(query, ['kind', 'compositionId', 'layerId', 'effectMatchName', 'effectIndex', 'controlMatchName', 'cursor', 'limit']) || !controlFilters(query)) return refusal('Control filters must use exact native matchNames and a positive effect index.');
  return { value: { kind: 'controls', compositionId: query.compositionId, layerId: query.layerId, ...(query.effectMatchName === undefined ? {} : { effectMatchName: String(query.effectMatchName) }), ...(query.controlMatchName === undefined ? {} : { controlMatchName: String(query.controlMatchName) }), ...(query.effectIndex === undefined ? {} : { effectIndex: Number(query.effectIndex) }) } };
}
function coverageQuery(query: Row): Parsed<RelationalQuery> {
  if (!text(query.compositionId, 128) || !text(query.layerId, 128) || !keys(query, ['kind', 'compositionId', 'layerId'])) return refusal('Coverage queries require only exact compositionId and layerId.');
  return { value: { kind: 'coverage', compositionId: query.compositionId, layerId: query.layerId } };
}
function desiredQuery(query: Row): Parsed<RelationalQuery> {
  if (!ordinal(query.controlInstanceId) || !keys(query, ['kind', 'controlInstanceId', 'cursor', 'limit'])) return refusal('Desired request queries require an exact controlInstanceId.');
  return { value: { kind: 'desired-requests', controlInstanceId: query.controlInstanceId } };
}
const QUERY_PARSERS: ReadonlyMap<string, (query: Row) => Parsed<RelationalQuery>> = new Map([
  ['effect-definitions', effectQuery], ['parameter-definitions', parameterQuery], ['parameter-facts', factQuery],
  ['controls', controlQuery], ['coverage', coverageQuery], ['desired-requests', desiredQuery],
]);
function queryEnvelope(args: Row): boolean {
  return keys(args, ['query', 'waitSeconds']) && transportWait(args.waitSeconds) && isRow(args.query) && pageFields(args.query);
}
/** The one typed relational query a tool call asks for, with its bounded limit and opaque cursor. */
export function parseRelationalQuery(args: Row): Parsed<RelationalQuery> {
  if (!queryEnvelope(args) || !isRow(args.query)) return refusal('query must be one typed relational query, with a bounded limit and opaque cursor.');
  const query = args.query, parser = QUERY_PARSERS.get(String(query.kind));
  if (!parser) return refusal('No typed relational query exists under this kind.');
  const parsed = parser(query);
  if ('error' in parsed) return parsed;
  return { value: { ...parsed.value, ...(query.cursor === undefined ? {} : { cursor: String(query.cursor) }), ...(query.limit === undefined ? {} : { limit: Number(query.limit) }) } };
}
/** The fact query describing one control, with an optional bounded cursor. */
export function parseControlDescription(args: Row): Parsed<RelationalQuery> {
  if (!keys(args, ['parameterDefinitionId', 'cursor', 'limit', 'waitSeconds']) || !transportWait(args.waitSeconds) || !text(args.parameterDefinitionId) || !pageFields(args)) return refusal('A control description requires an exact parameterDefinitionId and optional bounded fact cursor.');
  return { value: { kind: 'parameter-facts', parameterDefinitionId: args.parameterDefinitionId, ...(args.cursor === undefined ? {} : { cursor: String(args.cursor) }), ...(args.limit === undefined ? {} : { limit: Number(args.limit) }) } };
}

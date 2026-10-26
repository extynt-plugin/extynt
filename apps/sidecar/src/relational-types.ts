/**
 * The shapes of the relational tools: the typed queries over the retained graph, and the single-control parameter change
 * with the plan it prepares. The arguments parser, the preparation and the tool router of this family share them.
 */
import type { SetEffectControlOperation } from '@extynt/action-plan';
import type { ProjectSnapshot } from '@extynt/project-graph';
import type { Opaque } from './snapshot-view.js';

/** One typed relational query: which kind of rows to read and the exact identifiers that narrow them. */
export type RelationalQuery =
  | { kind: 'effect-definitions'; hostKey: string; matchName?: string; cursor?: string; limit?: number }
  | { kind: 'parameter-definitions'; effectDefinitionId: string; cursor?: string; limit?: number }
  | { kind: 'parameter-facts'; parameterDefinitionId: string; cursor?: string; limit?: number }
  | { kind: 'controls'; compositionId: string; layerId: string; effectMatchName?: string; effectIndex?: number; controlMatchName?: string; cursor?: string; limit?: number }
  | { kind: 'coverage'; compositionId: string; layerId: string }
  | { kind: 'desired-requests'; controlInstanceId: number; cursor?: string; limit?: number };

interface ParameterValue { kind: 'number'; value: number; unit?: string }
/** A request to set one observed control; the native unit spelling is carried explicitly and no semantic conversion is implied. */
export interface ParameterChangeRequest { controlInstanceId: number; observationId: string; value: ParameterValue; summary?: string }
/** A refusal with its code and message. */
export interface ParameterChangeFailure { ok: false; error: { code: string; message: string } }
/** A change that passed every check: the plan operation and the desired request kept apart from it. */
export interface PreparedParameterChange {
  ok: true;
  summary: string;
  operations: [SetEffectControlOperation];
  desired: { controlInstanceId: number; sourceObservationId: string; value: number; unit: string | null };
}
/** What the preparation judges a request against: the current observation, the scoped snapshot, the panel and the clock. */
export interface ParameterPreparationInput {
  request: ParameterChangeRequest;
  current: Opaque;
  snapshot: ProjectSnapshot | undefined;
  panelInstanceId: string | undefined;
  now: number;
}

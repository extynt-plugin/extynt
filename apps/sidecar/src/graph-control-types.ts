// The typed shapes of the relational graph: what a control is, where it lives, what was observed about it and what a desired change asks for.
import type { JsonValue } from "@extynt/decode";
import type { NativeParameterValueType } from "@extynt/project-graph";

/** The identity a retained observation is current for; `liveAt` is when the panel last read this exact native stamp from AE (read paths only). */
export type GraphContext = { project: string; owner: string; epoch: number; revision: number | null; liveAt: number | undefined };

type ControlAddress = {
  compositionId: string; layerId: string; itemIndex: number | null; layerIndex: number | null;
  effectIndex: number; effectMatchName: string; controlMatchName: string; propertyPath: string;
};

/** The live state of a control as last observed. */
export type CurrentControl = {
  valueType: NativeParameterValueType; value: number | number[] | null;
  minimum: number | null; maximum: number | null; units: string | null;
  keyframeCount: number | null; expressionEnabled: boolean | null;
  expressionPresent: boolean | null; isTimeVarying: boolean | null; canSetValue: boolean | null;
};

/** A control as read back from storage: its observation, address, current state and what is still unknown about it. */
export type ControlBinding = {
  state: "observed" | "stale" | "unknown"; controlInstanceId: number; observationId: string;
  parameterDefinitionId: string | null; effectDefinitionId: string | null;
  panelInstanceId: string; collectionSessionId: string; observedAt: number;
  stamp: { epoch: number; revision: number | null }; address: ControlAddress; current: CurrentControl;
  unknowns: string[];
  unitProvenance: { kind: string; observationId: string; collectionSessionId: string; semanticMeaning: "unknown" };
  nativePropertyIndices: number[]; sourceKind: string;
  coverage: { fields: string; dependencyClosure: "unknown"; absentOutsidePage: "unknown"; deletionReconciliation: "not-established" };
  writeAuthorizing: false;
};

/** Where an observation came from and which panel, session and native identity it is bound to. */
export type ControlEvidence = {
  sourceKind: "descriptor-page" | "value-page" | "blur-page" | "verified-readback";
  panel: string; session: string; context: GraphContext; at: number; proofReference: string | undefined;
};

/** An effect seen on a layer. */
export type EffectObservation = {
  compositionId: string; layerId: string; itemIndex: number | null; layerIndex: number | null;
  effectIndex: number; matchName: string; name: string; enabled: boolean | null;
};

/** What one page says about one control of an effect. */
export type ControlObservation = {
  effect: EffectObservation; matchName: string; name: string; relativePath: string; indexPath: string;
  current: CurrentControl; coverage: "descriptor-only" | "static-value" | "key-values-only" | "unknown";
  canVaryOverTime: boolean | null; canSetExpression: boolean | null;
};

/** A requested value for a control, tied to the observation it was prepared from. */
export interface DesiredParameterInput { planId: string; controlInstanceId: number; sourceObservationId: string; value: number | number[] }

/** The native ticket and read set a prepared change is bound to when it is applied. */
export interface DesiredApplyInput {
  planId: string; ticket: string; readSetDigest: string; panelInstanceId: string;
  stamp: { epoch: number; revision: number | null };
  sourceObservationId?: string; controlInstanceId?: number;
}

type DesiredRequest = {
  planId: string; controlInstanceId: number; sourceObservationId: string; panelInstanceId: string; collectionSessionId: string;
  stamp: { epoch: number; revision: number }; status: string; desiredValue: number | number[] | null;
  ticket: string | null; readSetDigest: string | null;
};

/** What the store knows of a plan's change request. */
export type DesiredParameterPlan = { state: "present"; request: DesiredRequest } | { state: "absent" } | { state: "unknown"; code: string };

/** The proof that a bound change was applied: the host's readback and the receipt it belongs to. */
export interface VerifiedReadbackInput {
  planId: string; ticket: string; readSetDigest: string; panelInstanceId: string;
  sourceObservationId?: string; receiptReference: string; readback: JsonValue;
}

// The operations a job executed, decoded once into the facts request coverage reads, so no matcher inspects a raw payload; sits between the workflow's operation log and request-coverage.
import { array, decode, fallback, number, object, rawJson, string } from "@extynt/decode";

/** A two-dimensional value: the first two numbers of a position key. */
export type Point = readonly [number, number];

/** An executed operation as the workflow records it; the payload is whatever the plan carried. */
export interface AppliedOperation<Payload> {
  type: string;
  payload: Payload;
}

/** What coverage reads from an executed operation: its type, its JSON text, the layer and property it addressed, and any position keys it wrote. */
export interface AppliedFact {
  type: string;
  json: string;
  layerId: string | undefined;
  propertyPath: string | undefined;
  matteLayerId: string | undefined;
  role: string | undefined;
  positionKeys: readonly Point[];
}

const text = fallback(string(), undefined);
const numbers = fallback(array(fallback(number(), undefined)), []);
const target = fallback(object({ layerId: text, propertyPath: text }), { layerId: undefined, propertyPath: undefined });
const keyframe = fallback(object({ value: numbers }), { value: [] });
const payloadFacts = object({ role: text, matteLayerId: text, target, keyframes: fallback(array(keyframe), []) });
const NO_FACTS = { role: undefined, matteLayerId: undefined, target: { layerId: undefined, propertyPath: undefined }, keyframes: [] };

function pointOf(values: readonly (number | undefined)[]): Point[] {
  const [x, y] = values;
  return x === undefined || y === undefined ? [] : [[x, y]];
}

function factOf<Payload>(operation: AppliedOperation<Payload>): AppliedFact {
  const decoded = decode(payloadFacts, operation.payload);
  const facts = decoded.ok ? decoded.value : NO_FACTS;
  const json = decode(rawJson(), operation.payload);
  return {
    type: operation.type,
    json: json.ok ? json.value : "",
    layerId: facts.target.layerId,
    propertyPath: facts.target.propertyPath,
    matteLayerId: facts.matteLayerId,
    role: facts.role,
    positionKeys: facts.keyframes.flatMap((key) => pointOf(key.value)),
  };
}

/** The facts of each executed operation, in order; a payload that is not an object yields facts with nothing addressed. */
export function appliedFacts<Payload>(applied: readonly AppliedOperation<Payload>[]): AppliedFact[] {
  return applied.map(factOf);
}

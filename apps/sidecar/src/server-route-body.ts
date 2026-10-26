// Reads, parses and decodes the body of one HTTP request against a route's body spec, reporting the diagnostic phases the route asks for.
import type { IncomingMessage } from "node:http";
import { decodeJson, isNotJson, type DecodeError, type Decoder } from "@extynt/decode";

import type { DiagnosticOutcome, DiagnosticPhase } from "./diagnostics.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import { readBody } from "./server-http-wire.js";
import type { RequestContext } from "./server-types.js";

/** An answer the sidecar refuses to give, as the standard error envelope with its diagnostic code and any `alongside` fields beside the envelope. */
export interface Refusal {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly alongside?: { readonly [field: string]: string };
}

/** The three ways a body can be unacceptable, each with the answer the route gives. */
export interface BodyRefusals {
  readonly tooLarge: Refusal;
  readonly notJson: Refusal;
  readonly invalid: Refusal;
}

interface BodyPhases {
  readonly read: DiagnosticPhase;
  readonly parse: DiagnosticPhase;
  readonly validate: DiagnosticPhase;
}

/** What a route accepts as its body: a decoder, a size limit and the refusals for what does not fit. An empty body decodes as `{}` when `emptyAsObject` is set; `explainInvalid` appends the decoder's reason to the invalid-body message. */
export interface BodySpec<Body> {
  readonly decoder: Decoder<Body>;
  readonly maxBytes: number;
  readonly refusals: BodyRefusals;
  readonly emptyAsObject?: true;
  readonly explainInvalid?: true;
  readonly phases?: BodyPhases;
}

type BodyRead<Body> =
  | { readonly kind: "read"; readonly body: Body; readonly bytes: number }
  | { readonly kind: "refused"; readonly refusal: Refusal };

interface BodySource {
  readonly request: IncomingMessage;
  readonly context: RequestContext;
  readonly diagnostics: Pick<HttpCoreCapability, "beginPhase" | "endPhase">;
}

interface PhaseClock {
  readonly name: DiagnosticPhase | undefined;
  readonly startedAt: number;
}

interface PhaseEnd {
  readonly outcome: DiagnosticOutcome;
  readonly bytes: number;
  readonly errorCode?: string;
}

function standardRefusals(maxBytes: number, invalid: Refusal): BodyRefusals {
  return {
    tooLarge: { status: 413, code: "BODY_LIMIT", message: `The request body may be at most ${maxBytes} bytes.` },
    notJson: { status: 400, code: "INVALID_JSON", message: "The request body must be valid JSON." },
    invalid,
  };
}

/** A JSON body spec: the decoder, the limit and the refusals, defaulting to the standard ones. */
export function jsonBody<Body>(decoder: Decoder<Body>, maxBytes: number, invalid: Refusal, overrides: Partial<BodyRefusals> = {}): BodySpec<Body> {
  return { decoder, maxBytes, refusals: { ...standardRefusals(maxBytes, invalid), ...overrides } };
}

/** A JSON body spec whose every failure (too large, not JSON, wrong shape) is the one refusal given. */
export function uniformBody<Body>(decoder: Decoder<Body>, maxBytes: number, refusal: Refusal): BodySpec<Body> {
  return { decoder, maxBytes, refusals: { tooLarge: refusal, notJson: refusal, invalid: refusal } };
}

function phasesOf<Body>(spec: BodySpec<Body>): Partial<BodyPhases> {
  return spec.phases ?? {};
}

function begin(source: BodySource, name: DiagnosticPhase | undefined): PhaseClock {
  return { name, startedAt: name === undefined ? 0 : source.diagnostics.beginPhase(source.context, name) };
}

function end(source: BodySource, clock: PhaseClock, finish: PhaseEnd): void {
  if (clock.name === undefined) return;
  source.diagnostics.endPhase(source.context, clock.name, clock.startedAt, finish);
}

async function readText<Body>(source: BodySource, spec: BodySpec<Body>): Promise<string | Refusal> {
  const clock = begin(source, phasesOf(spec).read);
  try {
    const text = await readBody(source.request, spec.maxBytes);
    end(source, clock, { outcome: "succeeded", bytes: Buffer.byteLength(text, "utf8") });
    return text;
  } catch {
    end(source, clock, { outcome: "rejected", bytes: 0, errorCode: spec.refusals.tooLarge.code });
    return spec.refusals.tooLarge;
  }
}

function explained<Body>(spec: BodySpec<Body>, error: DecodeError): Refusal {
  const { invalid } = spec.refusals;
  return spec.explainInvalid ? { ...invalid, message: `${invalid.message} ${error.message}` } : invalid;
}

/** Reads the body within its limit and decodes it; every failure is the refusal the spec names for it. */
export async function readDecoded<Body>(source: BodySource, spec: BodySpec<Body>): Promise<BodyRead<Body>> {
  const text = await readText(source, spec);
  if (typeof text !== "string") return { kind: "refused", refusal: text };
  const bytes = Buffer.byteLength(text, "utf8");
  const phases = phasesOf(spec), parsing = begin(source, phases.parse);
  const decoded = decodeJson(spec.emptyAsObject && text === "" ? "{}" : text, spec.decoder);
  if (decoded.ok) {
    end(source, parsing, { outcome: "succeeded", bytes });
    end(source, begin(source, phases.validate), { outcome: "succeeded", bytes });
    return { kind: "read", body: decoded.value, bytes };
  }
  const notJson = isNotJson(decoded.error), refusal = notJson ? spec.refusals.notJson : explained(spec, decoded.error);
  end(source, notJson ? parsing : begin(source, phases.validate), { outcome: "rejected", bytes, errorCode: refusal.code });
  return { kind: "refused", refusal };
}

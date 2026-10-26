// Reads what a verified plan kept: each applied control value, effect, font and preset it used, and the animations it spelled out.
import type { Operation } from "@extynt/action-plan";
import { decode } from "@extynt/decode";
import { isVerifiedOutcome, statusFromApplyReceipt, type StoredPlan, type StoredReceipt } from "@extynt/mcp-server";
import { habitSampleOf } from "./effect-notes-learn-habits.js";
import { receiptFacts, stepFacts, type OutcomeFacts, type StepFacts } from "./effect-notes-plan-facts.js";
import type { EffectNotesService } from "./effect-notes-service.js";
import type { HabitSampleInput, KeptEventInput, KeptUsageInput, NoteValue } from "./effect-notes-types.js";

const MAX_OPERATIONS = 200;
const MAX_KEYFRAMES = 32;
const MAX_FONTS = 8;
const PARADE = "ADBE Effect Parade";
const SIBLING_SUFFIX = /#(?:[2-9]|[1-9][0-9]+)$/;

interface Applied { operation: StepFacts; raw: Operation; layerId: string; propertyPath: string | undefined }
interface ControlWrite { effect: string; layerId: string; effectSegment: string; controlPath: string; values: Array<{ value: NoteValue; part: string }> }
interface Kept { values: KeptUsageInput[]; events: KeptEventInput[]; habits: HabitSampleInput[] }

/** `ADBE Effect Parade/<effect>/<control...>` as the notes store addresses a control: the parameter path under the effect, with the host's `#N` sibling suffix dropped. */
export function effectControlOf(propertyPath: string): { effectSegment: string; controlPath: string } | undefined {
  const segments = propertyPath.split("/"), [root, effectSegment, ...rest] = segments;
  if (root !== PARADE || effectSegment === undefined || rest.length === 0 || segments.includes("")) return undefined;
  return { effectSegment, controlPath: rest.map((segment) => segment.replace(SIBLING_SUFFIX, "")).join("/") };
}

function isVerified(outcome: OutcomeFacts | undefined, operation: StepFacts): outcome is OutcomeFacts {
  return outcome !== undefined && isVerifiedOutcome(outcome.outcome) && outcome.type === operation.type;
}

function landing(outcome: OutcomeFacts, operation: StepFacts): { layerId: string; propertyPath: string | undefined } {
  const sources = [outcome.targets, operation.target];
  return { layerId: sources.find((source) => source?.layerId !== undefined)?.layerId ?? "", propertyPath: sources.find((source) => source?.propertyPath !== undefined)?.propertyPath ?? operation.propertyPath };
}

function appliedOperation(raw: Operation, outcome: OutcomeFacts | undefined): Applied | undefined {
  const operation = decode(stepFacts, raw);
  return operation.ok && isVerified(outcome, operation.value) ? { operation: operation.value, raw, ...landing(outcome, operation.value) } : undefined;
}

function appliedOperations(plan: StoredPlan["plan"], outcomes: readonly (OutcomeFacts | undefined)[]): Applied[] {
  return plan.operations.slice(0, MAX_OPERATIONS).flatMap((operation, index) => appliedOperation(operation, outcomes[index]) ?? []);
}

function controlWrite(entry: Applied): ControlWrite | undefined {
  const { operation } = entry, control = entry.propertyPath ? effectControlOf(entry.propertyPath) : undefined;
  if (!operation.effectMatchName || !control) return undefined;
  const base = { effect: operation.effectMatchName, layerId: entry.layerId, ...control };
  if (operation.type === "set_effect_control") return { ...base, values: operation.value === undefined ? [] : [{ value: operation.value, part: "" }] };
  if (operation.type !== "animate_control") return undefined;
  return { ...base, values: operation.keyframes.slice(0, MAX_KEYFRAMES).flatMap((keyframe, index) => (keyframe.value === undefined ? [] : [{ value: keyframe.value, part: `|k${index}` }])) };
}

function fontsOf(operation: StepFacts): string[] {
  const fonts = [operation.font, ...operation.characterRanges.map((range) => range?.font)];
  return [...new Set(fonts.flatMap((font) => font ?? []))].slice(0, MAX_FONTS);
}

function eventsOf(planId: string, entry: Applied, write: ControlWrite | undefined): KeptEventInput[] {
  const { operation } = entry, event = (kind: KeptEventInput["kind"], name: string): KeptEventInput => ({ planId, kind, name });
  if (operation.type === "ensure_effect" && operation.effectMatchName) return [event("effect", operation.effectMatchName)];
  if (write) return [event("effect", write.effect)];
  if (operation.type === "apply_preset" && operation.presetId) return [event("preset", operation.presetId)];
  return operation.type === "set_text_document" ? fontsOf(operation).map((font) => event("font", font)) : [];
}

function valuesOf(planId: string, entry: Applied, write: ControlWrite | undefined): KeptUsageInput[] {
  if (!write) return [];
  return write.values.map((item) => ({ planId, matchName: write.effect, controlPath: write.controlPath, value: item.value, slot: `${entry.layerId}|${write.effectSegment}${item.part}` }));
}

function keptBy(planId: string, steps: readonly Applied[]): Kept {
  const kept: Kept = { values: [], events: [], habits: [] };
  for (const entry of steps) {
    const write = controlWrite(entry), habit = habitSampleOf(planId, { operation: entry.raw, layerId: entry.layerId, propertyPath: entry.propertyPath });
    kept.values.push(...valuesOf(planId, entry, write));
    kept.events.push(...eventsOf(planId, entry, write));
    if (habit) kept.habits.push(habit);
  }
  return kept;
}

/** What a verified plan kept: each applied static control value or keyframe value, each effect, font and preset it used, and the keyframe span and easing of each property it animated. Failed, rejected and unconfirmed steps count for nothing, and the whole plan must have verified. */
export function learnKeptFromReceipt(notes: EffectNotesService, input: { record: StoredPlan | undefined; receipt: StoredReceipt }): void {
  const { record, receipt } = input;
  const facts = decode(receiptFacts, receipt);
  if (!record || !facts.ok || statusFromApplyReceipt({ status: facts.value.status, postcondition: facts.value.postcondition }) !== "verified") return;
  const { values, events, habits } = keptBy(record.plan.planId, appliedOperations(record.plan, facts.value.operationOutcomes));
  if (values.length) notes.recordKeptUsage(values);
  if (events.length) notes.recordKeptEvents(events);
  if (habits.length) notes.recordHabitSamples(habits);
}

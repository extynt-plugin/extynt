// What a claimed apply item carries, decoded once at the runner's entry: the command, the reads the sidecar chose at claim, and the sidecar's own verdict on a precheck.
import { randomUUID } from "node:crypto";
import { boolean, decode, fallback, map, object, optional, skippingInvalid, string } from "@extynt/decode";
import type { Decoder, JsonObject, JsonValue } from "@extynt/decode";
import type { PanelRead } from "../read-queue.js";
import type { ReceiverOutcome } from "../receiver-types.js";
import type { ApplyCommand, ApprovedData } from "../verify/host-types.js";
import { objectOf, rowDecoder, textField } from "../verify/json-fields.js";

const MAX_READ_ID_LENGTH = 100;
const SCOPED_READ_SETS: ReadonlyArray<string> = ["metadata-read-set/1", "blur-control-read-set/1", "gaussian-create-read-set/1"];

interface ApplyReadSpecs {
  skipPrecheck: boolean;
  precheck: PanelRead;
  verify: PanelRead;
  preApply: JsonObject | null;
}

/** A claimed apply item with its command and the reads chosen for it; `approved` is the item itself. */
export interface ApplyInput {
  approved: ApprovedData;
  command: ApplyCommand;
  planId: string | undefined;
  reads: ApplyReadSpecs;
}

/** Why a claimed item cannot be applied, as the not-run receipt will say it. */
export interface InputRefusal { code: string; text: string }

const readFields = object({
  readId: optional(fallback(string(), undefined)),
  read: object({ scope: optional(fallback(string(), undefined)), compositionIds: optional(fallback(skippingInvalid(string()), undefined)), includeItems: optional(fallback(boolean(), undefined)) }),
});

function readIdOf(given: string | undefined, label: string): string {
  return given !== undefined && given.length <= MAX_READ_ID_LENGTH ? given : `${label}-${randomUUID().slice(0, 12)}`;
}

function readDecoder(label: string): Decoder<PanelRead> {
  return map(readFields, ({ readId, read }): PanelRead => {
    const ids = read.compositionIds ?? [];
    const id = readIdOf(readId, label);
    if (read.scope === "compositions" && ids.length >= 1) return { readId: id, reason: "apply", read: { scope: "compositions", compositionIds: [...ids], includeItems: read.includeItems === true } };
    return { readId: id, reason: "apply", read: { scope: "full" } };
  });
}

function wholeProject(label: string): PanelRead {
  return { readId: `${label}-${randomUUID().slice(0, 12)}`, reason: "apply", read: { scope: "full" } };
}

/** The read the item names for `label`, or a whole-project read when it names none that can be used. */
export function panelReadOf(value: JsonValue | undefined, label: string): PanelRead {
  const decoded = decode(readDecoder(label), value);
  return decoded.ok ? decoded.value : wholeProject(label);
}

function readSpecsOf(reads: JsonObject): ApplyReadSpecs {
  const skip = reads.precheck === null;
  return {
    skipPrecheck: skip,
    precheck: skip ? wholeProject("precheck") : panelReadOf(reads.precheck, "precheck"),
    verify: panelReadOf(reads.verify, "verify"),
    preApply: objectOf(reads.preApply) ?? null,
  };
}

function applyInputOf(approved: JsonObject): ApplyInput | InputRefusal {
  const command: ApplyCommand | undefined = objectOf(approved.command);
  if (!command || command.operation !== "apply_plan") return { code: "NO_COMMAND", text: "The sidecar approved the plan but the queued item carried no apply command." };
  return { approved, command, planId: textField(approved, "planId"), reads: readSpecsOf(objectOf(approved.reads) ?? {}) };
}

/** Reads a claimed apply item: its input, or the refusal that says why it has none. The item itself stays the approved data. */
export const applyItemDecoder: Decoder<ApplyInput | InputRefusal> = map(rowDecoder, applyInputOf);

/** True when the item could not be read as an apply. */
export function isRefusal(value: ApplyInput | InputRefusal): value is InputRefusal {
  return "code" in value && "text" in value;
}

/** True for a command that carries one of the read sets whose plan is bound to its approval digest. */
export function isScopedReadSet(command: ApplyCommand): command is ApplyCommand & { readSet: JsonObject } {
  const readSet = objectOf(command.readSet);
  return readSet !== undefined && SCOPED_READ_SETS.includes(textField(readSet, "schemaVersion") ?? "");
}

const admissionFields = object({
  admission: optional(fallback(object({ ok: optional(fallback(boolean(), undefined)), code: optional(fallback(string(), undefined)), text: optional(fallback(string(), undefined)) }), undefined)),
});

/** The sidecar's verdict on a read taken before an apply: null to go ahead, else why not. An answer without a verdict is a refusal. */
export function admissionRefusal(answer: ReceiverOutcome["body"]): InputRefusal | null {
  const decoded = decode(admissionFields, answer);
  const admission = decoded.ok ? decoded.value.admission : undefined;
  if (admission?.ok === true) return null;
  return {
    code: admission?.code ?? "PRECONDITION_UNREADABLE",
    text: admission?.text ?? "The sidecar gave no verdict on the project before applying, so nothing was run.",
  };
}

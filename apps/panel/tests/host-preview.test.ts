/**
 * The host half of the variant picker's previews (aePreviewControlValues), run in node:vm against a fake After Effects.
 *
 * For one static effect control it must remember the exact value, set each candidate and save a frame of it with the
 * ordinary capture, and put the control back and say whether the restore matched exactly, all inside one undo group
 * named "extynt preview" and never leaving a candidate value on the control, whatever fails on the way.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { FakeCompItem, FakeEffectParade, FakeLayer, FakeProperty } from "./host-apply-host.js";
import { hostTextFunction } from "./host-sources.js";
import { fieldOf, plain, readJson, recordOf, recordsOr, textAt } from "./json-narrow.js";
import { hostText, loadHostFiles } from "./host-sources.js";

const EFFECT = "ADBE Gaussian Blur 2";
const CONTROL = `${EFFECT}-0001`;
const PATH = `ADBE Effect Parade/${EFFECT}/${CONTROL}`;
const CANDIDATES = [{ id: "c0", value: 6 }, { id: "c1", value: 12 }, { id: "c2", value: 18 }];

type SetValueBehavior = (property: TracedProperty, value: JsonValue, trace: string[]) => void;
type RequestFields = Readonly<Record<string, JsonValue | undefined>>;

interface Options {
  readonly value?: JsonValue;
  readonly lock?: boolean;
  readonly keys?: number;
  readonly expression?: boolean;
  readonly setValue?: SetValueBehavior;
  readonly saveFrame?: (index: number) => void;
  readonly canSet?: boolean;
}

interface CapturedFrame {
  readonly time: number;
  readonly value: JsonValue;
  readonly path: string;
}

interface World {
  readonly property: TracedProperty;
  readonly trace: string[];
  readonly frames: CapturedFrame[];
  run(extra?: RequestFields): JsonObject;
}

interface Refusal {
  readonly what: string;
  readonly options?: Options;
  readonly extra: RequestFields;
  readonly code: string;
}

class TracedProperty extends FakeProperty {
  public readonly writes: JsonValue[] = [];

  public constructor(value: JsonValue, private readonly trace: string[], private readonly behave: SetValueBehavior | undefined) {
    super(CONTROL, "Blurriness", [], value, true);
  }

  public override setValue(value: JsonValue): void {
    this.writes.push(value);
    this.trace.push(`set:${JSON.stringify(value)}`);
    if (this.behave) this.behave(this, value, this.trace);
    else this.value = value;
  }
}

function tracedControl(options: Options, trace: string[]): TracedProperty {
  const property = new TracedProperty(options.value ?? 12, trace, options.setValue);
  property.numKeys = options.keys ?? 0;
  property.expressionEnabled = options.expression === true;
  property.canSetValue = options.canSet !== false;
  return property;
}

function compWithControl(property: TracedProperty, locked: boolean): FakeCompItem {
  const blur = new FakeProperty(EFFECT, "Gaussian Blur", [property], null, false);
  const layer = new FakeLayer("layer-1", [new FakeEffectParade([blur])], "Title");
  layer.locked = locked;
  return new FakeCompItem("comp-1", [layer], "Main");
}

function recordFrames(comp: FakeCompItem, world: { property: TracedProperty; trace: string[]; frames: CapturedFrame[]; written: Set<string> }, saveFrame: Options["saveFrame"]): void {
  let captures = 0;
  Object.assign(comp, {
    saveFrameToPng: (time: number, file: { fsName: string }) => {
      world.trace.push("frame");
      const index = captures;
      captures += 1;
      saveFrame?.(index);
      world.frames.push({ time, value: plain(world.property.value), path: file.fsName });
      world.written.add(file.fsName);
    },
  });
}

function fakeFileClasses(written: Set<string>) {
  class FakeFile {
    public constructor(public fsName: string) {}

    public get exists(): boolean {
      return written.has(this.fsName);
    }

    public remove(): void {
      written.delete(this.fsName);
    }
  }
  class FakeFolder {
    public static userData = { fsName: "/user-data" };
    public exists = true;

    public constructor(public fsName: string) {}

    public create(): boolean {
      return true;
    }
  }
  return { File: FakeFile, Folder: FakeFolder };
}

function request(extra: RequestFields): string {
  return JSON.stringify({
    operation: "preview_control_values",
    compositionId: "comp-1",
    layerId: "layer-1",
    effectMatchName: EFFECT,
    effectPath: `ADBE Effect Parade/${EFFECT}`,
    propertyPath: PATH,
    candidates: CANDIDATES,
    capture: { idPrefix: "variant-test", time: 1.5, width: 1920, height: 1080 },
    undoGroup: "extynt preview",
    ...extra,
  });
}

function world(options: Options = {}): World {
  const trace: string[] = [];
  const frames: CapturedFrame[] = [];
  const written = new Set<string>();
  const property = tracedControl(options, trace);
  const comp = compWithControl(property, options.lock === true);
  recordFrames(comp, { property, trace, frames, written }, options.saveFrame);
  const app = {
    project: { numItems: 1, item: () => comp },
    beginUndoGroup: (name: string) => trace.push(`begin:${name}`),
    endUndoGroup: () => trace.push("end"),
  };
  const context = vm.createContext({ app, CompItem: FakeCompItem, ...fakeFileClasses(written), $: { sleep: () => undefined } });
  loadHostFiles(context, "probe.jsx");
  const preview = hostTextFunction(context, "aePreviewControlValues");
  return { property, trace, frames, run: (extra = {}) => recordOf(readJson(preview(request(extra)))) };
}

function frameList(result: JsonObject): JsonObject[] {
  return recordsOr(result, "frames");
}

function fieldsOf(result: JsonObject, ...names: string[]): JsonValue[] {
  return names.map((name) => fieldOf(result, name) ?? null);
}

function rounding(property: TracedProperty, value: JsonValue): void {
  property.value = typeof value === "number" ? Math.round(value) : value;
}

test("it writes each candidate, saves a frame of it, and puts the exact original back, inside one undo group", () => {
  const w = world();
  const result = w.run();
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(result));
  assert.deepEqual(w.trace, ["begin:extynt preview", "set:6", "frame", "set:12", "frame", "set:18", "frame", "set:12", "end"], "the group opens before the first write and closes after the restore, and every write and frame is inside it");
  assert.deepEqual(w.frames.map((frame) => frame.value), [6, 12, 18], "each frame is a render with that candidate's value on the control");
  assert.ok(w.frames.every((frame) => frame.time === 1.5), "all at the one frame time the panel asked for");
  assert.equal(w.property.value, 12, "the control holds what it held");
  assert.deepEqual(fieldsOf(result, "original", "restored", "restoredValue"), [12, true, 12]);
  assert.deepEqual(fieldsOf(result, "mayHaveMutated", "mutationState", "undoGroup"), [true, "restored", "extynt preview"]);
  assert.deepEqual(frameList(result).map((frame) => fieldsOf(frame, "id", "ok", "shown")), [["c0", true, 6], ["c1", true, 12], ["c2", true, 18]]);
  assert.match(textAt(result, "frames", 0, "captureId"), /^variant-test-c0$/, "named through the evidence path's own capture ids");
  assert.equal(w.trace.filter((entry) => entry.startsWith("begin")).length, w.trace.filter((entry) => entry === "end").length, "one group, opened once and closed once");
});

test("a vector control is restored component for component, and a colour given as RGB keeps its alpha as apply_plan writes it", () => {
  const w = world({ value: [0.25, 0.5, 0.75, 1] });
  const result = w.run({ candidates: [{ id: "a", value: [1, 0, 0] }, { id: "b", value: [0, 1, 0, 0.5] }] });
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(result));
  assert.deepEqual(plain(w.property.writes), [[1, 0, 0, 1], [0, 1, 0, 0.5], [0.25, 0.5, 0.75, 1]]);
  assert.deepEqual(plain(w.property.value), [0.25, 0.5, 0.75, 1]);
  assert.equal(fieldOf(result, "restored"), true);
});

test("a restore that did not match is reported as unresolved, never as success", () => {
  const exact = world({ setValue: rounding });
  const stuck = world({ setValue: (property, value) => {
    if (value !== 12) property.value = value;
  } });
  const roundedOriginal = world({ value: 12.4, setValue: rounding });
  assert.equal(fieldOf(exact.run(), "restored"), true, "a control that stores what it is given restores exactly");
  for (const [what, scenario] of [["a control that ignores the restore", stuck], ["a control that rounds what it is given", roundedOriginal]] as const) {
    const result = scenario.run();
    assert.equal(fieldOf(result, "ok"), false, what);
    assert.equal(fieldOf(result, "restored"), false, what);
    assert.equal(fieldOf(result, "mutationState"), "unknown", what);
    assert.equal(fieldOf(result, "mayHaveMutated"), true, what);
    assert.notEqual(fieldOf(result, "restoredValue"), fieldOf(result, "original"), what);
    assert.deepEqual(scenario.trace.slice(-1), ["end"], `${what}: the undo group is still closed`);
  }
});

test("a write that throws part-way still restores the original before the group closes", () => {
  const w = world({ setValue: (property, value) => {
    property.value = value;
    if (value === 18) throw new Error("After Effects threw after taking the value");
  } });
  const result = w.run();
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "code"), "PREVIEW_FAILED");
  assert.equal(w.property.value, 12, "a candidate value is never left on the control");
  assert.deepEqual(fieldsOf(result, "restored", "mutationState"), [true, "restored"], "the failure was cleaned up, so it is not an unresolved mutation");
  assert.deepEqual(w.trace.slice(-2), ["set:12", "end"]);
  assert.equal(frameList(result).length, 2, "the frames already taken are kept");
});

test("a restore that itself throws is unresolved", () => {
  let writes = 0;
  const w = world({ setValue: (property, value) => {
    writes += 1;
    if (writes === 3) throw new Error("no");
    property.value = value;
  } });
  const result = w.run({ candidates: [{ id: "a", value: 6 }, { id: "b", value: 18 }] });
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "restored"), false);
  assert.equal(fieldOf(result, "mutationState"), "unknown");
  assert.equal(fieldOf(result, "error", "code"), "RESTORE_FAILED");
  assert.equal(w.property.value, 18, "and the result says plainly that the control was left holding a candidate");
  assert.equal(fieldOf(result, "restoredValue"), 18);
  assert.deepEqual(w.trace.slice(-1), ["end"], "the undo group is still closed");
});

test("when the last candidate is the original value no restore write is needed, and the read-back still proves it", () => {
  const w = world();
  const result = w.run({ candidates: [{ id: "a", value: 6 }, { id: "b", value: 12 }] });
  assert.equal(fieldOf(result, "restored"), true);
  assert.deepEqual(w.trace, ["begin:extynt preview", "set:6", "frame", "set:12", "frame", "end"]);
});

test("a frame that cannot be saved is only a missing picture; the other candidates are still pictured and the value is restored", () => {
  const w = world({ saveFrame: (index) => {
    if (index === 0) throw new Error("render failed");
  } });
  const result = w.run();
  assert.equal(fieldOf(result, "ok"), true, JSON.stringify(result));
  assert.deepEqual(frameList(result).map((frame) => fieldOf(frame, "ok")), [false, true, true]);
  assert.equal(typeof fieldOf(result, "frames", 0, "error", "code"), "string");
  assert.equal(w.property.value, 12);
});

const STATE_REFUSALS: Refusal[] = [
  { what: "keyframes", options: { keys: 2 }, extra: {}, code: "PROPERTY_NOT_STATIC" },
  { what: "an expression", options: { expression: true }, extra: {}, code: "PROPERTY_NOT_STATIC" },
  { what: "a locked layer", options: { lock: true }, extra: {}, code: "TARGET_LOCKED" },
  { what: "a control After Effects will not set", options: { canSet: false }, extra: {}, code: "PROPERTY_NOT_SETTABLE" },
  { what: "a control that is not on the layer", extra: { propertyPath: `ADBE Effect Parade/${EFFECT}/${EFFECT}-0099` }, code: "PROPERTY_NOT_FOUND" },
  { what: "a composition that is not there", extra: { compositionId: "comp-9" }, code: "TARGET_NOT_FOUND" },
];

const REQUEST_REFUSALS: Refusal[] = [
  { what: "a layer that is not there", extra: { layerId: "layer-9" }, code: "TARGET_NOT_FOUND" },
  { what: "a vector for a scalar control", extra: { candidates: [{ id: "c0", value: [1, 2] }] }, code: "INVALID_VALUE" },
  { what: "a scalar for a vector control", options: { value: [1, 2] }, extra: {}, code: "INVALID_VALUE" },
  { what: "a control that holds no number", options: { value: "text" }, extra: {}, code: "PROPERTY_NOT_NUMERIC" },
  { what: "a different undo group name", extra: { undoGroup: "extynt — something" }, code: "INVALID_COMMAND" },
  { what: "no capture", extra: { capture: undefined }, code: "INVALID_COMMAND" },
  { what: "no candidates", extra: { candidates: [] }, code: "INVALID_COMMAND" },
  { what: "five candidates", extra: { candidates: [1, 2, 3, 4, 5].map((value) => ({ id: `c${value}`, value })) }, code: "INVALID_COMMAND" },
  { what: "an unsafe capture id", extra: { capture: { idPrefix: "../escape", time: 1, width: 1920, height: 1080 } }, code: "INVALID_COMMAND" },
];

function assertRefused(refusal: Refusal): void {
  const w = world(refusal.options);
  const before = w.property.value;
  const result = w.run(refusal.extra);
  assert.equal(fieldOf(result, "ok"), false, refusal.what);
  assert.equal(fieldOf(result, "error", "code"), refusal.code, refusal.what);
  assert.deepEqual(fieldsOf(result, "mayHaveMutated", "mutationState"), [false, "not-applied"], refusal.what);
  assert.deepEqual(w.trace, [], `${refusal.what}: no write, no frame, no undo group`);
  assert.deepEqual(w.property.value, before, refusal.what);
}

test("it refuses what is not a static, settable, unlocked control before writing anything or opening an undo group", () => {
  for (const refusal of [...STATE_REFUSALS, ...REQUEST_REFUSALS]) assertRefused(refusal);
  const garbage = vm.createContext({ app: { project: {} } });
  loadHostFiles(garbage, "probe.jsx");
  assert.equal(fieldOf(readJson(String(vm.runInContext("aePreviewControlValues('not json')", garbage))), "error", "code"), "INVALID_COMMAND");
});

test("the preview is not an apply or an undo: it uses no plan undo group name and no Edit > Undo", () => {
  const source = hostText("probe.jsx");
  const start = source.indexOf("var AE_PREVIEW_UNDO_GROUP");
  const end = source.indexOf("var aePreviewControlValues");
  const preview = source.slice(start, end + 600);
  assert.ok(!/executeCommand/.test(preview), "it never presses Undo, so it cannot take back anything it did not make");
  assert.ok(!/extynt \\u2014/.test(preview), "its group can never be mistaken for a plan's");
});

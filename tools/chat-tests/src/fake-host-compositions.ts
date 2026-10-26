/** Composition operations: creating one, and changing its size, timing, motion blur and renderer. */

import { isWireObject } from "@extynt/fake-plugin";
import type { CompositionSnapshot } from "@extynt/project-graph";
import { mintId, resolveComposition, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { boundedNumber, placeholderOf, refuse, targetOf, textOf, tuple3, type Field } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

type CompositionSettingsPatch = Partial<Pick<CompositionSnapshot, "width" | "height" | "pixelAspect" | "duration" | "frameRate" | "backgroundColor" | "workAreaStart" | "workAreaDuration" | "motionBlur" | "shutterAngle" | "shutterPhase" | "motionBlurSamplesPerFrame" | "motionBlurAdaptiveSampleLimit" | "renderer">>;

interface NumericSetting { key: string; field: keyof CompositionSettingsPatch; min: number; max: number; integer: boolean }

const NUMERIC_SETTINGS: readonly NumericSetting[] = [
  { key: "width", field: "width", min: 4, max: 8192, integer: true },
  { key: "height", field: "height", min: 4, max: 8192, integer: true },
  { key: "pixelAspect", field: "pixelAspect", min: 0.01, max: 100, integer: false },
  { key: "durationSeconds", field: "duration", min: 0.01, max: 10800, integer: false },
  { key: "frameRate", field: "frameRate", min: 1, max: 120, integer: false },
  { key: "workAreaStart", field: "workAreaStart", min: 0, max: 10800, integer: false },
  { key: "workAreaDuration", field: "workAreaDuration", min: 0.001, max: 10800, integer: false },
  { key: "shutterAngle", field: "shutterAngle", min: 0, max: 720, integer: false },
  { key: "shutterPhase", field: "shutterPhase", min: -360, max: 360, integer: false },
  { key: "motionBlurSamplesPerFrame", field: "motionBlurSamplesPerFrame", min: 2, max: 64, integer: true },
  { key: "motionBlurAdaptiveSampleLimit", field: "motionBlurAdaptiveSampleLimit", min: 2, max: 256, integer: true },
];

const COMPOSITION_SETTING_KEYS: readonly string[] = [...NUMERIC_SETTINGS.map((entry) => entry.key), "backgroundColor", "motionBlur", "renderer"];

/** Creates a composition under a `__new__:` placeholder and binds the id the fixture mints for it. */
export function applyCreateComposition(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const placeholder = placeholderOf(operation.newCompositionId, "create_composition declares newCompositionId, which must be a __new__:<name> placeholder for the composition it creates.");
  if (context.bindings[placeholder]) refuse("INVALID_OPERATION", `create_composition declares ${placeholder}, which an earlier operation in this call already created.`);
  const name = textOf(operation.name, "create_composition name", { min: 1, max: 256 });
  const width = Math.round(boundedNumber(operation.width, "create_composition width", { min: 4, max: 8192 }));
  const height = Math.round(boundedNumber(operation.height, "create_composition height", { min: 4, max: 8192 }));
  const duration = boundedNumber(operation.durationSeconds, "create_composition durationSeconds", { min: 0.01, max: 10800 });
  const frameRate = boundedNumber(operation.frameRate, "create_composition frameRate", { min: 1, max: 120 });
  const id = mintId(context, "comp");
  const composition: CompositionSnapshot = {
    id, name, width, height, pixelAspect: 1, duration, frameRate,
    workAreaStart: 0, workAreaDuration: duration, layers: [], currentTime: 0,
  };
  context.snapshot.compositions.push(composition);
  context.createdCompositions.set(placeholder, composition);
  context.bindings[placeholder] = id;
  context.snapshot.items?.push({ id, name, type: "composition", parentFolderId: null, compositionId: id, sourceId: null });
  return `created composition ${id} "${name}"`;
}

function numericSettingsPatch(settings: WireObject): Record<string, number> {
  const patch: Record<string, number> = {};
  for (const { key, field, min, max, integer } of NUMERIC_SETTINGS) {
    const raw = settings[key];
    if (raw === undefined) continue;
    const value = boundedNumber(raw, `settings.${key}`, { min, max });
    patch[field] = integer ? Math.round(value) : value;
  }
  return patch;
}

function rendererOf(value: Field, renderers: readonly string[] | undefined): string {
  const name = textOf(value, "settings.renderer", { min: 1, max: 64 });
  if (renderers && !renderers.includes(name)) refuse("RENDERER_NOT_AVAILABLE", `The composition lists renderers ${renderers.join(", ") || "none"}; "${name}" is not one.`);
  return name;
}

function checkedSettings(settings: WireObject): void {
  const keys = Object.keys(settings);
  if (keys.length === 0) refuse("INVALID_VALUE", "set_composition_settings requires at least one setting.");
  for (const key of keys) if (!COMPOSITION_SETTING_KEYS.includes(key)) refuse("INVALID_VALUE", `set_composition_settings has no setting "${key}"; it sets ${COMPOSITION_SETTING_KEYS.join(", ")}.`);
  const motionBlur = settings.motionBlur;
  if (motionBlur !== undefined && typeof motionBlur !== "boolean") refuse("INVALID_VALUE", "settings.motionBlur must be true or false.");
}

function optionalSettingsPatch(settings: WireObject, renderers: readonly string[] | undefined): CompositionSettingsPatch {
  const motionBlur = settings.motionBlur, renderer = settings.renderer, background = settings.backgroundColor;
  return {
    ...(typeof motionBlur === "boolean" ? { motionBlur } : {}),
    ...(renderer === undefined ? {} : { renderer: rendererOf(renderer, renderers) }),
    ...(background === undefined ? {} : { backgroundColor: tuple3(background, "settings.backgroundColor") }),
  };
}

function clampWorkArea(composition: CompositionSnapshot): void {
  if (composition.workAreaStart > composition.duration) composition.workAreaStart = composition.duration;
  if (composition.workAreaStart + composition.workAreaDuration > composition.duration)
    composition.workAreaDuration = composition.duration - composition.workAreaStart;
}

/** Writes the named composition settings, then clamps the work area into the new duration. */
export function applySetCompositionSettings(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const composition = resolveComposition(context, targetOf(operation).compositionId, "set_composition_settings");
  const settings = operation.settings;
  if (!isWireObject(settings)) refuse("INVALID_VALUE", "set_composition_settings requires a settings object.");
  checkedSettings(settings);
  Object.assign(composition, { ...numericSettingsPatch(settings), ...optionalSettingsPatch(settings, composition.renderers) });
  clampWorkArea(composition);
  return `updated composition ${composition.id}`;
}

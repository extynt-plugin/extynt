/** The model settings the sidecar last reported, and the questions the picker and the settings form ask of them. */
import type { ModelService, ModelSettings, ModelSlot } from "./panel-model-wire.js";

let current: ModelSettings | null = null;

/** The model settings as the sidecar last reported them, or null before it has. */
export function getModelSettings(): ModelSettings | null {
  return current;
}

/** Holds the settings the sidecar just reported. */
export function setModelSettings(settings: ModelSettings): void {
  current = settings;
}

/** The model that is running now, or null when none is set up. */
export function activePrimary(): ModelSlot | null {
  return current?.active.primary ?? null;
}

/** The model the user chose for the picker, or null when none is chosen. */
export function pickerSlot(): ModelSlot | null {
  return current?.slots.primary ?? null;
}

/** The listed service with this id, or null. */
export function serviceById(id: string): ModelService | null {
  return current?.services.find((service) => service.id === id) ?? null;
}

/** Records the level the running model now sends, which it reports again when its level list is read. */
export function reportEffectiveEffort(effort: string | null): void {
  if (current === null || current.active.primary === null) return;
  current = { ...current, active: { ...current.active, primary: { ...current.active.primary, effectiveEffort: effort } } };
}

// The focus report After Effects sends about what it shows now (open project, composition, selected layers), decoded strictly and turned into the live focus the sidecar keeps.
import { array, literal, nullable, number, optional, refine, string, strictObject } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

import { MAX_FOCUS_NAMED, MAX_FOCUS_SELECTED, type LiveFocus } from "./live-focus.js";

const LAYER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const identifier = string({ pattern: LAYER_ID });
const count = number({ int: true, min: 0, max: Number.MAX_SAFE_INTEGER });

const selectedLayer = strictObject({ id: identifier, index: count, name: string({ maxLength: 512 }) });

const report = strictObject({
  schemaVersion: literal("0.1"),
  projectPath: nullable(string({ maxLength: 4096 })),
  projectName: string({ maxLength: 512 }),
  epoch: nullable(count),
  revision: nullable(count),
  activeCompositionId: nullable(identifier),
  activeCompositionName: nullable(string({ maxLength: 512 })),
  selected: array(identifier, { maxLength: MAX_FOCUS_SELECTED }),
  selectedLayers: array(selectedLayer, { maxLength: MAX_FOCUS_NAMED }),
  observedAt: optional(count),
  items: optional(count),
  time: optional(nullable(number({ min: 0 }))),
});

type Report = Infer<typeof report>;

function namesOnlySelected(candidate: Report): candidate is Report {
  const selected = new Set(candidate.selected);
  return candidate.selectedLayers.every((layer) => selected.has(layer.id));
}

/** The strict shape of a focus report: unknown fields, wrong types and oversize lists are refused rather than trimmed, and every named layer is a selected one. */
export const liveFocusReport = refine(report, namesOnlySelected, "selectedLayers naming only selected layer ids");

/** A decoded focus report. */
export type LiveFocusReport = Infer<typeof liveFocusReport>;

/** The live focus a report becomes, stamped with when it arrived. */
export function focusOf(reported: LiveFocusReport, receivedAt: number): LiveFocus {
  return {
    projectPath: reported.projectPath,
    projectName: reported.projectName,
    epoch: reported.epoch,
    revision: reported.revision,
    activeCompositionId: reported.activeCompositionId,
    activeCompositionName: reported.activeCompositionName,
    selected: [...reported.selected],
    selectedLayers: reported.selectedLayers.map((layer) => ({ id: layer.id, index: layer.index, name: layer.name })),
    receivedAt,
    ...(reported.observedAt === undefined ? {} : { observedAt: reported.observedAt }),
    ...(reported.items === undefined ? {} : { items: reported.items }),
    ...(typeof reported.time === "number" ? { time: reported.time } : {}),
  };
}

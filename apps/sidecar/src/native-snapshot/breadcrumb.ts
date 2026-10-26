/** The apply breadcrumb: the file the host writes before each operation and removes when the apply ends. One that survives names the plan and operation After Effects was running when it quit or crashed. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeJson, type Decoder, fallback, map, number, object, optional, string } from "@extynt/decode";
import type { InterruptedApply } from "./types.js";

const FILE_NAME = "apply-in-flight.json";
const MAX_BYTES = 4096;

const breadcrumbShape = object({
  planId: string({ pattern: /^[A-Za-z0-9._:-]{1,256}$/ }),
  index: number({ int: true, min: 0 }),
  operationCount: optional(fallback(number({ int: true, min: 1 }), undefined)),
  operation: optional(fallback(string({ pattern: /^[a-z_]{1,64}$/ }), undefined)),
  layerId: optional(fallback(string({ pattern: /^[A-Za-z0-9._:-]{1,128}$/ }), undefined)),
  startedAt: optional(fallback(string({ pattern: /^[0-9]{1,16}$/ }), undefined)),
});

const interrupted: Decoder<InterruptedApply> = map(breadcrumbShape, (fact) => ({
  planId: fact.planId, index: fact.index, operationCount: fact.operationCount ?? null, operation: fact.operation ?? null, layerId: fact.layerId ?? null, startedAt: fact.startedAt ?? null,
}));

function fileText(directory: string): string | null {
  try { return readFileSync(join(directory, FILE_NAME), "utf8").slice(0, MAX_BYTES); } catch { return null; }
}

/** The breadcrumb in `directory` (default `Folder.userData/extynt` as the jsx wrote it, not the sidecar's lower-case state directory), or null when there is none or it does not parse. A missing file is the normal case. The same bounds apply as to what a probe reported. */
export function readApplyBreadcrumb(directory: string = join(homedir(), "Library", "Application Support", "extynt")): InterruptedApply | null {
  const text = fileText(directory), decoded = text === null ? null : decodeJson(text, interrupted);
  return decoded?.ok ? decoded.value : null;
}

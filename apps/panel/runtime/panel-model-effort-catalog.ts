/** The effort levels of the model in the picker: read from the sidecar when the menu opens, kept for a few minutes, read again after. */
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import type { Reply } from "./panel-transport.js";
import { effortListStale } from "./panel-model-effort.js";
import { refreshPickerTrigger } from "./panel-model-pill.js";
import { reportEffectiveEffort } from "./panel-model-store.js";
import { effortReportDecoder } from "./panel-model-wire.js";
import type { EffortReport, ModelSlot } from "./panel-model-wire.js";

type EffortCatalog =
  | { readonly kind: "loading"; readonly key: string }
  | { readonly kind: "failed"; readonly key: string; readonly message: string }
  | { readonly kind: "ready"; readonly key: string; readonly efforts: ReadonlyArray<string>; readonly fetchedAt: number };

interface Pending {
  readonly key: string;
  readonly kept: EffortCatalog | null;
}

const PATH = "/v1/settings/model/efforts";
let catalog: EffortCatalog | null = null;

/** The levels held for the model last asked about (being read, refused with a sentence, or in hand with the time they were read), or null before any ask. */
export function effortCatalog(): EffortCatalog | null {
  return catalog;
}

function catalogKey(slot: ModelSlot | null): string {
  return slot ? [slot.service, slot.baseUrl, slot.model].join("|") : "";
}

function heldFor(key: string): EffortCatalog | null {
  return catalog !== null && catalog.key === key ? catalog : null;
}

function isCurrent(known: EffortCatalog | null): boolean {
  return known !== null && known.kind === "ready" && !effortListStale(known.fetchedAt, Date.now());
}

function settle(pending: Pending, reply: Reply<EffortReport>, onChange: () => void): void {
  if (catalog === null || catalog.key !== pending.key) return;
  if (reply.ok) {
    catalog = { kind: "ready", key: pending.key, efforts: reply.value.efforts, fetchedAt: Date.now() };
    reportEffectiveEffort(reply.value.effectiveEffort);
    refreshPickerTrigger();
  } else {
    catalog = pending.kept ?? { kind: "failed", key: pending.key, message: reply.error.reason };
  }
  onChange();
}

/**
 * Reads the model's levels unless a fresh list is held. A list already held stays shown while it is read again, and a
 * failed read never replaces one; `onChange` runs when an answer lands.
 */
export function loadEffortCatalog(slot: ModelSlot | null, onChange: () => void): void {
  const key = catalogKey(slot);
  const known = heldFor(key);
  if (!key || isCurrent(known)) return;
  const kept = known?.kind === "ready" ? known : null;
  catalog = kept ?? { kind: "loading", key };
  const query = known === null ? "?slot=primary" : "?slot=primary&refresh=1";
  const context = transportContext("GET", PATH, diagnosticId("model-efforts"));
  send({ method: "GET", path: PATH + query, body: null, context, decoder: effortReportDecoder }, (reply) => {
    settle({ key, kept }, reply, onChange);
  });
}

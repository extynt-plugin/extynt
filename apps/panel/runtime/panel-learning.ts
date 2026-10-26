/**
 * Learning the installed effects, as the status bar's quietest state. What the line says comes from panel-catalogue-line.ts;
 * this module keeps the last progress the sidecar reported, reads /health while the panel is visible, and tells the bar
 * when the answer changes. A screen reader hears the start and the end, not every count.
 */
import { object } from "@extynt/decode";
import { catalogueAnnouncement, catalogueProgressDecoder, deriveCatalogueLine } from "./panel-catalogue-line.js";
import type { CatalogueLine, CatalogueProgress } from "./panel-catalogue-line.js";
import { touchStatus } from "./panel-status-signal.js";
import { diagnosticId, every, pollContext, send } from "./panel-transport.js";
import { uiState } from "./ui-state.js";

const POLL_MS = 5000;
const healthDecoder = object({ catalogue: catalogueProgressDecoder });

let progress: CatalogueProgress | null = null;
let shown: CatalogueLine | null = null;
let spoken = "";
let polling = false;

/** The line to show now, or null when there is nothing to say. */
export function learningLine(): CatalogueLine | null {
  return deriveCatalogueLine(progress);
}

/** The sentence a screen reader should hear after the last change; empty when there is none. */
export function learningAnnouncement(): string {
  return spoken;
}

function render(): void {
  const line = learningLine();
  const words = catalogueAnnouncement(shown, line, progress);
  if (words) spoken = words;
  shown = line;
  touchStatus();
}

/** The sidecar's latest catalogue progress; anything that is not a report (an error, an older sidecar) clears the line. */
export function observeCatalogueProgress(next: CatalogueProgress | null): void {
  progress = next;
  render();
}

function poll(): void {
  if (polling || !uiState().native || document.hidden) return;
  polling = true;
  const context = pollContext("GET", "/health", diagnosticId("catalogue-line"));
  send({ method: "GET", path: "/health", body: null, context, decoder: healthDecoder }, (reply) => {
    polling = false;
    observeCatalogueProgress(reply.ok ? reply.value.catalogue : null);
  });
}

/** Wiring runs before the transport is ready, so the first read is the first tick, not an immediate request. */
export function wireLearning(): void {
  every(poll, POLL_MS);
}

/**
 * The one quiet line in the main view about learning the user's installed effects: a pure derivation from the sidecar's
 * catalogue progress. It exists only while there is something to say that the user can act on or watch: learning in
 * progress, new effects waiting for an empty project, or a stop that reopening the panel clears.
 */

import type { Infer } from "@extynt/decode";
import { fallback, number, object, string } from "@extynt/decode";
import { wholeCount } from "./wire-decoders.js";
import { t } from "./panel-language.js";

type CatalogueLineKind = "learning" | "pending" | "stopped" | "unavailable";
/** The line and its kind; the kind decides what a screen reader hears. */
export interface CatalogueLine {
  readonly kind: CatalogueLineKind;
  readonly text: string;
}


const progressDecoder = object({
  state: string(),
  installed: wholeCount,
  collected: wholeCount,
  pending: wholeCount,
  failed: wholeCount,
  probedThisRun: wholeCount,
  totalProbeMs: wholeCount,
  pauseReason: fallback(string(), null),
  engineHosts: fallback(number(), null),
});

/** The sidecar's catalogue progress, as it arrives on /health or from a catalogue start; null for anything that is not a report. */
export const catalogueProgressDecoder = fallback(progressDecoder, null);
/** How far the learning of the installed effects has got. */
export type CatalogueProgress = Infer<typeof progressDecoder>;

/** The collector hands the host this many effects per page at most (CATALOGUE_MAX_EFFECTS in the sidecar). */
export const CATALOGUE_PAGE_EFFECTS = 16;
const PAGE_HANDOFF_MS = 1000;
const MIN_MEASURED_EFFECTS = 8;
const FEW_SECONDS_MAX_EFFECTS = 8;

/**
 * How long the pending effects will take, in words that match how sure the panel is: measured on this machine this
 * session (rounded up to 5 s, then to minutes), a few seconds for a handful, and nothing for a long list it has no
 * measurement for.
 */
export function learnEstimate(pending: number, probedThisRun: number, totalProbeMs: number): string | null {
  if (pending <= 0) return null;
  if (probedThisRun >= MIN_MEASURED_EFFECTS && totalProbeMs > 0) {
    const seconds = (pending * (totalProbeMs / probedThisRun) + Math.ceil(pending / CATALOGUE_PAGE_EFFECTS) * PAGE_HANDOFF_MS) / 1000;
    return seconds <= 60 ? t("status.learn.seconds", { count: Math.max(5, Math.ceil(seconds / 5) * 5) }) : t("status.learn.minutes", { count: Math.ceil(seconds / 60) });
  }
  return pending <= FEW_SECONDS_MAX_EFFECTS ? t("status.learn.fewSeconds") : null;
}

function heldByProject(counts: CatalogueProgress): boolean {
  return counts.state === "paused" && counts.pauseReason === "not-scratch-project";
}

function pendingText(counts: CatalogueProgress): string {
  const fresh = counts.collected > 0, estimate = learnEstimate(counts.pending, counts.probedThisRun, counts.totalProbeMs);
  if (estimate === null) return fresh ? t("status.learn.pendingNew", { count: counts.pending }) : t("status.learn.pending", { count: counts.pending });
  const values = { count: counts.pending, estimate: estimate };
  return fresh ? t("status.learn.pendingNewEstimate", values) : t("status.learn.pendingEstimate", values);
}

function pendingLine(counts: CatalogueProgress): CatalogueLine {
  return { kind: "pending", text: pendingText(counts) };
}

function activeLine(counts: CatalogueProgress): CatalogueLine | null {
  const done = Math.max(0, counts.installed - counts.pending);
  if (counts.engineHosts === 0 && counts.pending > 0) return { kind: "unavailable", text: t("status.learn.noHost") };
  if (counts.pending > 0 && heldByProject(counts)) return pendingLine(counts);
  if (counts.state === "collecting") return { kind: "learning", text: t("status.learn.progress", { done: done, total: counts.installed }) };
  return { kind: "stopped", text: t("status.learn.stopped", { done: done, total: counts.installed }) };
}

/** The line to show for the progress, or null when there is nothing to say. */
export function deriveCatalogueLine(counts: CatalogueProgress | null): CatalogueLine | null {
  if (!counts || counts.installed <= 0 || (counts.pending <= 0 && counts.state !== "collecting")) return null;
  return counts.state === "paused" || counts.state === "collecting" ? activeLine(counts) : null;
}

function startedAnnouncement(line: CatalogueLine): string {
  return line.kind === "learning" ? t("status.learn.startedBackground") : line.text.replace(/[.。]?$/, t("status.sentenceEnd"));
}

/**
 * What a screen reader hears, if anything: when learning starts, when it finishes, and when new effects need an empty
 * project. Count changes within a kind are silent, so a 584-effect run is two announcements, not hundreds.
 */
export function catalogueAnnouncement(previous: CatalogueLine | null, next: CatalogueLine | null, progress: CatalogueProgress | null): string | null {
  if (next) return previous?.kind === next.kind ? null : startedAnnouncement(next);
  return previous?.kind === "learning" && progress?.state === "complete" ? t("status.learn.finished") : null;
}

/**
 * Compares a completed capture with the earlier captures of the same composition: byte-identical pixels, or what moved
 * since the latest earlier one. The capture routes of the server use it to answer a reader without eyes.
 */
import { compareFrameSummaries, validateFrameSummary, type FrameSummary } from "@extynt/visual-evidence";
import type { CaptureRecord } from "./server-types.js";

/** `identicalTo` names an earlier capture with the same pixels; `changedFrom` names the latest earlier one and what moved since. */
export interface CaptureComparison {
  identicalTo?: string;
  changedFrom?: { captureId: string; cells: number[]; meanDelta: number };
}

function summaryOf(capture: CaptureRecord): FrameSummary | undefined {
  const measured = validateFrameSummary(capture.receipt?.summary);
  return "ok" in measured ? undefined : measured;
}

function earlierCaptures(captures: ReadonlyMap<string, CaptureRecord>, captureId: string, compositionId: string): CaptureRecord[] {
  const earlier: CaptureRecord[] = [];
  for (const [id, capture] of captures) {
    if (id === captureId) break;
    if (capture.status === "completed" && capture.request.compositionId === compositionId) earlier.push(capture);
  }
  return earlier;
}

function identicalEarlier(current: CaptureRecord, newestFirst: readonly CaptureRecord[]): CaptureRecord | undefined {
  const hash = current.receipt?.frameHash;
  return typeof hash === "string" ? newestFirst.find((candidate) => candidate.receipt?.frameHash === hash) : undefined;
}

function changeSince(current: CaptureRecord, newestFirst: readonly CaptureRecord[]): CaptureComparison {
  const now = summaryOf(current);
  const previous = newestFirst.find((candidate) => summaryOf(candidate));
  const before = previous ? summaryOf(previous) : undefined;
  const change = previous && before && now ? compareFrameSummaries(before, now) : null;
  return previous && change ? { changedFrom: { captureId: previous.captureId, cells: change.cells, meanDelta: change.meanDelta } } : {};
}

/** The comparison of one completed capture with its earlier siblings; empty when it has none. */
export function compareToEarlierCaptures(captures: ReadonlyMap<string, CaptureRecord>, captureId: string): CaptureComparison {
  const current = captures.get(captureId);
  if (!current || current.status !== "completed") return {};
  const newestFirst = earlierCaptures(captures, captureId, current.request.compositionId).reverse();
  const same = identicalEarlier(current, newestFirst);
  return same ? { identicalTo: same.captureId } : changeSince(current, newestFirst);
}

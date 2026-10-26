// The verdict for an operation that writes a file: render, export, save and collect are confirmed by the file the host measured.
import { exactStep, failedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";
import type { HostStep } from "./host-step.js";

const FILE_VERIFICATIONS: ReadonlySet<string> = new Set(["render-file-written", "mogrt-file-written", "frame-file-written", "project-file-saved"]);

const FILE_BASES: Readonly<Record<string, string>> = {
  export_mogrt: "mogrt-file-written",
  export_frame: "frame-file-written",
  save_project: "project-file-saved",
  collect_project: "project-file-saved",
};

/** Exact when the host measured a written file with bytes in it, failed when the file is empty, null when the host did not measure one. */
export function writtenFileVerdict(kind: string, step: HostStep, details: Details): VerifiedStep | null {
  const { bytes } = step;
  if (!FILE_VERIFICATIONS.has(step.verification ?? "") || bytes === undefined) return null;
  const evidence = { ...details, file: step.file ?? null, bytes };
  return bytes > 0 ? exactStep(kind, FILE_BASES[kind] ?? "render-file-written", evidence) : failedStep(kind, "written-file-empty", evidence);
}

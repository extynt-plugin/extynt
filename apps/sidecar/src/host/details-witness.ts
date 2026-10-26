// What vouches for details that outlive a connection. The plugin's layer hash covers the layer head, every property row (value at the current time,
// expression, keyframe count, flags) and a content digest of what the details call supplies: every key's time, value and easing, text documents' text,
// marker fields, mask and shape path vertices and layer reference targets. It does not cover a text document's styling (font, size, fill: the text
// suite exposes only the text), so a persisted detail is reusable only when the project is also provably unedited since the details were read: the same
// After Effects process at the same project revision (which rises on every edit and on undo), or a saved project that is clean now and was clean then,
// with its file unchanged. The witness also stays as a second guard for everything the digest does cover.
import { stat } from "node:fs/promises";
import { anyResult } from "../native-snapshot/index.js";
import type { NativeReadSet } from "../native-snapshot/index.js";

/**
 * What vouches for a detail: `session` is the process, epoch, revision and project of one moment of one After Effects run (null when the stamp
 * carries no revision), `file` the path, size and times of the saved file of a project that is not dirty (null for an unsaved or edited project).
 */
export interface Witness {
  session: string | null;
  file: string | null;
}

/** Where one project's entries live: its file, else its name (an unsaved project has nothing else to be told by). */
export function projectKeyOf(read: NativeReadSet): string {
  const path = read.stamp.projectPath ?? anyResult(read)?.project.filePath ?? null;
  return path === null ? `unsaved:${read.stamp.projectName}` : `file:${path}`;
}

function sessionWitness(read: NativeReadSet): string | null {
  const { epoch, revision, projectPath } = read.stamp;
  return revision === null ? null : ["s", read.ping.aeVersion, read.ping.pid, epoch, revision, projectPath ?? ""].join("|");
}

async function statWitness(path: string, aeVersion: string): Promise<string | null> {
  try {
    const found = await stat(path);
    return found.isFile() ? ["f", aeVersion, path, found.size, found.mtimeMs, found.ctimeMs, found.ino].join("|") : null;
  } catch { return null; }
}

async function fileWitness(read: NativeReadSet): Promise<string | null> {
  const project = anyResult(read)?.project, path = project?.filePath ?? read.stamp.projectPath;
  if (!project || project.dirty || path === null) return null;
  return statWitness(path, read.ping.aeVersion);
}

/** The witness of `read`, taken before any detail is asked for: a change during the fetch is caught by `unchangedSince`. */
export async function witnessOf(read: NativeReadSet): Promise<Witness> {
  return { session: sessionWitness(read), file: await fileWitness(read) };
}

/** Whether a detail recorded under `recorded` may stand for what After Effects holds under `now`. */
export function witnessHolds(recorded: Witness, now: Witness): boolean {
  if (recorded.session !== null && recorded.session === now.session) return true;
  return recorded.file !== null && recorded.file === now.file;
}

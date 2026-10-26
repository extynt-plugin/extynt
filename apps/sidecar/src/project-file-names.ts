/**
 * The names a project's records are kept under: one stable stem per project, shared by its database and its append-only chat log.
 * One project can contain many chat sessions; their records share the stem and keep a separate sessionId on every record.
 */
import { decode, literal, object, string } from "@extynt/decode";
import type { Opaque } from "./snapshot-view.js";

type ProjectFileKind = "saved" | "unsaved";

/** The stable names of one project's files. */
export interface ProjectFileLink {
  schemaVersion: "extynt.project-link/1";
  projectId: string;
  kind: ProjectFileKind;
  stem: string;
  databaseFile: string;
  chatLogFile: string;
}

const PROJECT_ID = /^[a-f0-9]{64}$/;
const linkShape = object({
  schemaVersion: literal("extynt.project-link/1"),
  kind: literal("saved", "unsaved"),
  projectId: string({ pattern: PROJECT_ID }),
  stem: string(),
  databaseFile: string(),
  chatLogFile: string(),
});

/** The link for a project; throws INVALID_PROJECT_LINK when the id is not a project fingerprint. */
export function projectFileLink(kind: ProjectFileKind, projectId: string): ProjectFileLink {
  if ((kind !== "saved" && kind !== "unsaved") || !PROJECT_ID.test(projectId)) throw Error("INVALID_PROJECT_LINK");
  const stem = `${kind}-${projectId}`;
  return { schemaVersion: "extynt.project-link/1", projectId, kind, stem, databaseFile: `${stem}.extynt`, chatLogFile: `${stem}.jsonl` };
}

/** A client-provided link, accepted only when all filenames match its stable identity. This does not establish project freshness or native edit authority. */
export function normalizeProjectFileLink(value: Opaque): ProjectFileLink | null {
  const candidate = decode(linkShape, value);
  if (!candidate.ok) return null;
  const { kind, projectId, stem, databaseFile, chatLogFile } = candidate.value;
  const expected = projectFileLink(kind, projectId);
  return stem === expected.stem && databaseFile === expected.databaseFile && chatLogFile === expected.chatLogFile ? expected : null;
}

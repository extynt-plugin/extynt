// The batch of chat events the panel appends to the automatic chat log, decoded once: a session, its events and the project files each message belongs to.
import { array, decode, decodeOrThrow, type Infer, jsonObject, type JsonObject, type JsonValue, literal, map, number, object, refine, string } from "@extynt/decode";

import { projectFileLink, type ProjectFileLink } from "./project-file-names.js";

const MAX_EVENTS = 128;
const MAX_PROJECT_LINKS = 16;
const PROJECT_ID = /^[a-f0-9]{64}$/;

/** One event of a chat session: a session record or a message, with the project files it touches. */
export interface ChatLogEvent {
  readonly type: "session" | "message";
  readonly eventId: string;
  readonly revision: number;
  readonly data: JsonObject;
  readonly projectLinks: readonly ProjectFileLink[];
}

/** A chat session's new events. */
export interface ChatLogBatch {
  readonly sessionId: string;
  readonly name: string;
  readonly events: readonly ChatLogEvent[];
}

const linkFields = object({
  schemaVersion: literal("extynt.project-link/1"),
  kind: literal("saved", "unsaved"),
  projectId: string({ pattern: PROJECT_ID }),
  stem: string(),
  databaseFile: string(),
  chatLogFile: string(),
});

function namesMatch(link: Infer<typeof linkFields>): link is ProjectFileLink {
  const expected = projectFileLink(link.kind, link.projectId);
  return link.stem === expected.stem && link.databaseFile === expected.databaseFile && link.chatLogFile === expected.chatLogFile;
}

const projectLink = refine(linkFields, namesMatch, "a project link whose file names match its project");

const projectLinkList = array(projectLink, { maxLength: MAX_PROJECT_LINKS });

function linksIn(data: JsonObject): JsonValue | undefined {
  return data.projectLinks;
}

function validLinks(data: JsonObject): data is JsonObject {
  const given = linksIn(data);
  return given === undefined || decode(projectLinkList, given).ok;
}

function distinctByStem(links: ReadonlyArray<ProjectFileLink>): ProjectFileLink[] {
  const kept: ProjectFileLink[] = [];
  for (const link of links) if (!kept.some((existing) => existing.stem === link.stem)) kept.push(link);
  return kept;
}

function projectLinksOf(data: JsonObject): ProjectFileLink[] {
  const given = linksIn(data);
  return given === undefined ? [] : distinctByStem(decodeOrThrow(projectLinkList, given));
}

const eventFields = object({
  type: literal("session", "message"),
  eventId: string({ pattern: /^[A-Za-z0-9._:-]{1,160}$/ }),
  revision: number({ int: true, min: 1, max: 1_000_000 }),
  data: refine(jsonObject, validLinks, "an event object whose project links are valid"),
});

const chatLogEvent = map(eventFields, (event): ChatLogEvent => ({ ...event, projectLinks: projectLinksOf(event.data) }));

function hasContent(text: string): boolean {
  return text.trim().length > 0;
}

const sessionId = map(refine(string({ maxLength: 128 }), (text): text is string => hasContent(text), "a session id with content"), (text) => text.trim());

/** The body of `POST /v1/chat-logs`. */
export const chatLogBatch = object({
  schemaVersion: literal("extynt.chat-log/0.1"),
  sessionId,
  name: string({ maxLength: 256 }),
  events: array(chatLogEvent, { minLength: 1, maxLength: MAX_EVENTS }),
});

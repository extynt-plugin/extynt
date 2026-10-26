/** Fixtures the chat-store suites share: stored chats, a panel booted over them, and readers for the Chats view. */
import type { FakeSession, StubResponder } from "./contract-xhr.js";
import { chatResponder, element, noticeTexts, nth, required } from "./contract-helpers.js";
import { createPanelHarness, type PanelHarness } from "./contract.test.js";
import { type JsonObject } from "@extynt/decode";

/** One minute in milliseconds. */
export const MINUTE = 60000;
/** A responder that answers every chat request with the given answer and extra reply fields. */
export const answered = (answer: string, extra: JsonObject = {}) => chatResponder(() => ({ answer, ...extra }));

/** What differs between stored chats: the message texts and the project they belong to. */
export interface StoredOptions {
  readonly texts?: string[];
  readonly project?: string | null;
}

/** A stored chat of the given age, with alternating user and assistant messages. */
export function stored(id: string, title: string, ageMs: number, options: StoredOptions = {}): FakeSession {
  const at = Date.now() - ageMs;
  const texts = options.texts ?? ["hello from " + title];
  return {
    id,
    title,
    project: options.project === undefined ? "Fixture.aep" : options.project,
    createdAt: at,
    updatedAt: at,
    messages: texts.map((text, index) => ({ kind: index % 2 === 0 ? "user" : "assistant", text, at })),
  };
}

/** A panel booted against a sidecar that already holds the given chats, `current` being the one it has open. */
export function withSessions(sessions: FakeSession[], current: string | null, respond?: StubResponder): PanelHarness {
  return createPanelHarness({
    ...(respond ? { respond } : {}),
    sidecar: (sidecar) => {
      for (const session of sessions) sidecar.sessions.set(session.id, session);
      sidecar.current = current;
    },
  });
}

/** The chat title the title bar shows. */
export const titleOf = (harness: PanelHarness): string =>
  required(element(harness, "chat-title").find((node) => node.classList.has("chat-title-text"))).textContent;
/** The rows of the Chats view. */
export const listRows = (harness: PanelHarness) => element(harness, "sessions-list").all((node) => node.classList.has("session-row"));
/** The first line of each Chats row, in order. */
export const rowTitles = (harness: PanelHarness): string[] =>
  listRows(harness).map((row) => nth(required(row.find((node) => node.classList.has("session-item"))).childNodes, 0).textContent);
/** Opens the Chats view. */
export const openChats = (harness: PanelHarness): void => {
  harness.click("chat-title");
};
/** The pressable item of the Chats row that starts with the given title. */
export const itemFor = (harness: PanelHarness, title: string) =>
  required(required(listRows(harness).find((row) => row.textContent.startsWith(title))).find((node) => node.classList.has("session-item")));
/** The saves the panel sent for one chat. */
export const putsTo = (harness: PanelHarness, id: string) =>
  harness.requests.filter((record) => record.method === "PUT" && record.url.endsWith("/v1/ui/sessions/" + id));
/** The notices in the activity log, one per line. */
export const activityLog = (harness: PanelHarness): string => noticeTexts(harness).join("\n");

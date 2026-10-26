/** Small builders and finders the contract suites share: plan rows, chat replies, and lookups in the stub tree. */
import { StubElement, createPanelHarness, testNow, type PanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { fieldOf, readJson, recordOf, textAt } from "./json-narrow.js";
import type { StubEventExtra } from "./contract-dom.js";
import { type JsonObject } from "@extynt/decode";

export function planRow(planId: string, extra: JsonObject = {}): JsonObject {
  return { planId, status: "prepared", source: "panel", summary: "Plan " + planId, createdAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T10:00:00.000Z", postcondition: null, mayHaveMutated: false, visual: true, presentation: { title: "Plan " + planId, values: [], notices: [], warnings: [] }, ...extra };
}

export function planCard(planId: string, extra: JsonObject = {}): JsonObject {
  return { planId, title: "Fade in the title", operations: ["animate_property"], rows: [{ label: "Animate Opacity", target: "TITLE", before: 0, after: 100 }], warnings: [], notices: [], expressions: [], requiresAcknowledgement: false, autoApply: false, ...extra };
}

export function chatReply(extra: JsonObject = {}): StubResponse {
  return { status: 200, text: JSON.stringify({ ok: true, outcome: "answered", answer: "Done.", plans: [], tools: [], reasoning: [], ...extra }) };
}

/** Answers POST /v1/chat with a reply built from the request (so requestId matches); everything else falls through. */
export function chatResponder(build: (body: JsonObject) => JsonObject): (record: StubRequestRecord) => StubResponse | undefined {
  return (record) => {
    if (!record.url.endsWith("/v1/chat") || record.method !== "POST") return undefined;
    const body = recordOf(readJson(record.body));
    return chatReply({ requestId: textAt(body, "requestId"), ...build(body) });
  };
}

/** A responder whose chat reply carries this answer, plus any extra reply fields. */
export function answered(answer: string, extra: JsonObject = {}): (record: StubRequestRecord) => StubResponse | undefined {
  return chatResponder(() => ({ answer, ...extra }));
}

export function textsOf(root: StubElement, className: string): string[] { return root.all((node) => node.classList.has(className)).map((node) => node.textContent); }
export function buttonsNamed(root: StubElement, text: string): StubElement[] { return root.all((node) => node.tagName === "BUTTON" && node.textContent === text); }
export function buttonStarting(root: StubElement, text: string): StubElement | null { return root.find((node) => node.tagName === "BUTTON" && node.textContent.startsWith(text)); }
export function output(harness: PanelHarness): StubElement { const node = harness.el("chat-output"); if (!node) throw new Error("no chat-output"); return node; }
/** Plan cards are gone from the thread: this stays so a test can prove none is drawn. */
export function cards(harness: PanelHarness): StubElement[] { return output(harness).all((node) => node.classList.has("plan-card")); }
/** The one-line folds the thread keeps for runs of plans. */
export function folds(harness: PanelHarness): StubElement[] { return output(harness).all((node) => node.classList.has("plan-fold")); }

/** The tool calls the panel made, with their arguments. */
export function toolCalls(harness: PanelHarness, name: string): Array<JsonObject> {
  return harness.requestsTo("/v1/mcp/tools/call").map((record) => recordOf(readJson(record.body))).filter((body) => fieldOf(body, "name") === name).map((body) => recordOf(fieldOf(body, "arguments") ?? {}));
}

export function chatBodies(harness: PanelHarness): Array<JsonObject> {
  return harness.requests.filter((record) => record.url.endsWith("/v1/chat") && record.method === "POST").map((record) => recordOf(readJson(record.body)));
}

export function bodyOf(record: StubRequestRecord): JsonObject { return recordOf(readJson(record.body)); }

/** Boots with plans already on the sidecar and a chat that answers with these plan cards. */
export function harnessWithPlanCard(card: JsonObject, listed: JsonObject[] = [planRow(textAt(card, "planId"))], extra: { sidecar?: (sidecar: PanelHarness["sidecar"]) => void } = {}): PanelHarness {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.plans = listed; extra.sidecar?.(sidecar); }, respond: chatResponder(() => ({ plans: [card] })) });
  harness.send("fade the title in");
  return harness;
}

/** The first responder that answers wins; the rest fall through to the fake sidecar. */
export function firstAnswer(...responders: Array<((record: StubRequestRecord) => StubResponse | undefined) | undefined>): (record: StubRequestRecord) => StubResponse | undefined {
  return (record) => { for (const responder of responders) { const answer = responder?.(record); if (answer) return answer; } return undefined; };
}

/** Holds POST /v1/chat open, so a turn stays running until a test answers it. */
export function holdChat(record: StubRequestRecord): StubResponse | undefined { return record.url.endsWith("/v1/chat") && record.method === "POST" ? { hold: true } : undefined; }

/** Answers the progress poll for the turn whose request id the chat body carried. */
export function progressResponder(progress: (requestId: string) => JsonObject | null): (record: StubRequestRecord) => StubResponse | undefined {
  return (record) => {
    if (!record.url.includes("/v1/chat/progress")) return undefined;
    const requestId = decodeURIComponent(record.url.split("requestId=")[1] ?? "");
    return { status: 200, text: JSON.stringify({ ok: true, progress: progress(requestId) }) };
  };
}

/** A key press in the composer. */
export function pressKey(harness: PanelHarness, key: string, extra: StubEventExtra = {}): void { harness.el("chat-message")?.dispatch("keydown", { key, shiftKey: false, isComposing: false, ...extra }); }
export function typeInComposer(harness: PanelHarness, text: string): void { const composer = harness.el("chat-message"); if (composer) composer.value = text; }

/** The chat rows of one kind ("user", "assistant", "error", "notice"). */
export function rowsOf(harness: PanelHarness, kind: string): StubElement[] { return output(harness).all((node) => node.classList.has("msg") && node.classList.has(kind)); }
export function noticeTexts(harness: PanelHarness): string[] { return rowsOf(harness, "notice").map((node) => node.textContent); }

/** What the sidecar's `host` event carries; `host` overrides fields of the host status, `extra` the event itself. */
export function hostEventBody(state: string, host: JsonObject = {}, extra: JsonObject = {}): JsonObject {
  return { host: { state, since: testNow(), pluginVersion: "0.1.0", aeVersion: "26.2", idleAgeMs: 2000, stall: null, busyKind: null, ...host }, hostInstanceId: "native:1:1", nativeAccessQuarantine: null, ...extra };
}

/** A selection as the sidecar reports it in a `focus` event or the bootstrap. */
export function focusPayload(extra: JsonObject = {}): JsonObject {
  return { project: "Fixture.aep", compositionId: "c1", compositionName: "Main", selected: 1, layerNames: ["TITLE"], kinds: ["text"], selectionFingerprint: "f1", at: 1, ...extra };
}

/** What the status bar shows now: its state and tone, role, the two lines of words, and the labels of its buttons. */
export function bar(harness: PanelHarness): { state: string; tone: string; role: string; text: string; sub: string; actions: string[] } {
  const node = harness.el("status-bar");
  if (!node) throw new Error("no status-bar");
  const attribute = (name: string): string => node.getAttribute(name) ?? "";
  const words = (selector: string): string => node.querySelector(selector)?.textContent ?? "";
  const buttons = node.all((entry) => entry.tagName === "BUTTON" && entry.getAttribute("data-action") !== null);
  return { state: attribute("data-state"), tone: attribute("data-tone"), role: attribute("role"), text: words(".bar-text"), sub: words(".bar-sub"), actions: buttons.map((entry) => entry.textContent) };
}

/** The status bar's button for this action id ("stop", "apply", "discard", "continue", "use-variant", ...). */
export function barButton(harness: PanelHarness, id: string): StubElement | null {
  return harness.el("status-bar")?.find((node) => node.tagName === "BUTTON" && node.getAttribute("data-action") === id) ?? null;
}

/** Every button on the page, wherever it is, whose action id is this one: used to prove an action exists in one place only. */
export function allButtonsFor(harness: PanelHarness, label: string): StubElement[] {
  return harness.body().all((node) => node.tagName === "BUTTON" && node.textContent === label);
}

/** Opens the sheet by pressing the bar, and returns its element. */
export function openSheet(harness: PanelHarness): StubElement {
  const sheet = harness.el("sheet");
  if (!sheet) throw new Error("no sheet");
  if (sheet.hidden) harness.el("bar-main")?.click();
  return sheet;
}

/** The sheet's section titles, in order. */
export function sheetTitles(harness: PanelHarness): string[] { return openSheet(harness).all((node) => node.classList.has("sheet-title")).map((node) => node.textContent); }

/** A job as the sidecar reports it on the activity event and the bootstrap. */
export function jobPayload(extra: JsonObject = {}): JsonObject {
  return { jobId: "job_1", requestId: "req_1", goal: "Build a launch film", status: "working", via: "request", activity: "title card entrance", cycle: 3, step: 7, plansApplied: 2, requestOpen: false, plans: [], startedAt: new Date(Date.now() - 41 * 60000).toISOString(), waits: [], checklist: null, specialists: [], ...extra };
}

/** The first change row in the sheet, with its detail opened. */
export function openedChange(harness: PanelHarness): StubElement {
  const sheet = openSheet(harness);
  const row = sheet.find((node) => node.classList.has("change-row"));
  if (!row) throw new Error("no change row in the sheet");
  if (!row.find((node) => node.classList.has("change-detail"))) row.find((node) => node.classList.has("change-head"))?.click();
  const opened = sheet.find((node) => node.classList.has("change-row"));
  if (!opened) throw new Error("the change row went away");
  return opened;
}

/** The value, or a thrown error saying what the test expected to find. */
export function present<T>(found: T | null | undefined, what: string): T {
  if (found === null || found === undefined) throw new Error("expected " + what + " to exist");
  return found;
}

/** The entry at `index` (negative counts from the end), or a thrown error naming the index. */
export function nth<T>(list: ReadonlyArray<T>, index: number): T {
  return present(list.at(index), "an entry at index " + index + " of " + list.length);
}

/** The stub element with this id, or a thrown error naming it. */
export function element(harness: PanelHarness, id: string): StubElement {
  return present(harness.el(id), "the element #" + id);
}

/** The value, or a thrown error when the lookup found nothing; the stack names the line that expected it. */
export function required<T>(found: T | null | undefined): T {
  return present(found, "the value this lookup is meant to find");
}

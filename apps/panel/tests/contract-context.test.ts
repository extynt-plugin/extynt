/** Panel contract: what extynt will act on. The context chip, its list of layers, and the caption a sent message keeps. */
import assert from "node:assert/strict";
import test from "node:test";
import { chatBodies, chatReply, focusPayload, holdChat, output, required } from "./contract-helpers.js";
import { createPanelHarness, type FakeSidecar, type PanelHarness, type StubElement } from "./contract.test.js";
import { arrayOf, fieldOf, readJson, recordOf, textAt, type Found, plain } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];

function withFocus(extra: JsonObject | null): (sidecar: FakeSidecar) => void {
  return (sidecar) => {
    sidecar.focus = extra === null ? null : focusPayload(extra);
  };
}
function chip(harness: PanelHarness): StubElement {
  const node = harness.el("context-chip");
  if (!node) throw new Error("no context-chip");
  return node;
}
function harnessRowHidden(harness: PanelHarness): boolean {
  return harness.el("context-chip-row")?.hidden === true;
}
function chipText(harness: PanelHarness): string {
  return chip(harness).querySelector(".ctx-chip-text")?.textContent ?? "";
}
function captions(harness: PanelHarness): string[] {
  return output(harness)
    .all((node) => node.classList.has("msg-context"))
    .map((node) => node.textContent);
}
function popover(harness: PanelHarness): StubElement | null {
  return harness.el("context-chip-row")?.find((node) => node.getAttribute("role") === "group") ?? null;
}
function listed(harness: PanelHarness): string[] {
  return (
    popover(harness)
      ?.all((node) => node.classList.has("menu-row-name"))
      .map((node) => node.textContent) ?? []
  );
}
function storedMessages(harness: PanelHarness): ReadonlyArray<JsonValue> {
  return arrayOf(fieldOf(plain([...harness.sidecar.sessions.values()][0]), "messages"));
}
function storedContext(harness: PanelHarness, index: number): Found {
  return fieldOf(storedMessages(harness)[index], "context");
}
function finishTurn(harness: PanelHarness): void {
  const body = required(chatBodies(harness).at(-1));
  harness
    .held()
    .find((xhr) => xhr.url.endsWith("/v1/chat") && !xhr.ended)
    ?.respond(200, textAt(chatReply({ requestId: textAt(body, "requestId") }), "text"));
}
function runningTurn(extra: JsonObject | null = {}): PanelHarness {
  const harness = createPanelHarness({ sidecar: withFocus(extra), respond: holdChat });
  harness.send("fade it in");
  return harness;
}

test("the chip names one selected layer and its composition", () => {
  assert.equal(chipText(createPanelHarness({ sidecar: withFocus({}) })), "Main · TITLE");
});

test("the chip names the composition and the count for several layers", () => {
  assert.equal(chipText(createPanelHarness({ sidecar: withFocus({ selected: 3, layerNames: ["A", "B", "C"] }) })), "Main · 3 layers");
});

test("the chip says whole comp when nothing is selected", () => {
  assert.equal(chipText(createPanelHarness({ sidecar: withFocus({ selected: 0, layerNames: [] }) })), "Main · whole comp");
});

test("the chip says so when no composition is open, whether the focus is empty or missing", () => {
  assert.equal(
    chipText(createPanelHarness({ sidecar: withFocus({ compositionId: null, compositionName: null, selected: 0, layerNames: [] }) })),
    "No composition open",
  );
  assert.equal(chipText(createPanelHarness({ sidecar: withFocus(null) })), "No composition open");
});

test("the chip follows the selection as focus events arrive", () => {
  const harness = createPanelHarness({ sidecar: withFocus({}) });
  harness.sse("focus", { focus: focusPayload({ selected: 2, layerNames: ["LOGO", "TITLE"] }) });
  assert.equal(chipText(harness), "Main · 2 layers");
  harness.sse("focus", { focus: focusPayload({ selected: 0, layerNames: [] }) });
  assert.equal(chipText(harness), "Main · whole comp");
  harness.sse("focus", { focus: focusPayload({ compositionId: "c2", compositionName: "Outro", layerNames: ["BG"] }) });
  assert.equal(chipText(harness), "Outro · BG");
  harness.sse("focus", { focus: null });
  assert.equal(chipText(harness), "No composition open");
});

test("the chip is shown while the host is known, and hidden when neither host nor focus are", () => {
  assert.equal(harnessRowHidden(createPanelHarness()), false);
  assert.equal(
    harnessRowHidden(createPanelHarness({ respond: (record) => (record.url.endsWith("/v1/ui/bootstrap") ? { fail: true } : undefined) })),
    true,
  );
  assert.equal(harnessRowHidden(createPanelHarness({ native: null })), true);
});

test("clicking the chip opens and closes the list of selected layers", () => {
  const harness = createPanelHarness({ sidecar: withFocus({ selected: 3, layerNames: ["A", "B", "C"] }) });
  assert.equal(chip(harness).getAttribute("aria-expanded"), "false");
  assert.equal(popover(harness)?.hidden, true);
  harness.click("context-chip");
  assert.equal(chip(harness).getAttribute("aria-expanded"), "true");
  assert.equal(popover(harness)?.hidden, false);
  assert.deepEqual(listed(harness), ["A", "B", "C"]);
  harness.click("context-chip");
  assert.equal(chip(harness).getAttribute("aria-expanded"), "false");
  assert.equal(popover(harness)?.hidden, true);
});

test("the list shows at most eight layer names, then and N more", () => {
  const harness = createPanelHarness({ sidecar: withFocus({ selected: 12, layerNames: [...NAMES, "I", "J"] }) });
  harness.click("context-chip");
  assert.deepEqual(listed(harness), NAMES);
  assert.deepEqual(
    popover(harness)
      ?.all((node) => node.classList.has("menu-row-detail"))
      .map((node) => node.textContent),
    ["and 4 more"],
  );
});

test("the list says what happens with nothing selected or no composition", () => {
  const none = createPanelHarness({ sidecar: withFocus({ selected: 0, layerNames: [] }) });
  none.click("context-chip");
  assert.deepEqual(listed(none), ["No layers selected. extynt looks at the whole composition."]);
  const closed = createPanelHarness({ sidecar: withFocus(null) });
  closed.click("context-chip");
  assert.deepEqual(listed(closed), ["No composition open"]);
});

test("an open list follows the selection", () => {
  const harness = createPanelHarness({ sidecar: withFocus({}) });
  harness.click("context-chip");
  harness.sse("focus", { focus: focusPayload({ selected: 2, layerNames: ["X", "Y"] }) });
  assert.deepEqual(listed(harness), ["X", "Y"]);
});

test("a message is captioned with where it was sent: a layer, several layers, or the whole comp", () => {
  const sent = (extra: JsonObject): string[] => {
    const harness = createPanelHarness({ sidecar: withFocus(extra) });
    harness.send("hello");
    return captions(harness);
  };
  assert.deepEqual(sent({}), ["in Main · TITLE"]);
  assert.deepEqual(sent({ selected: 3, layerNames: ["A", "B", "C"] }), ["in Main · 3 layers"]);
  assert.deepEqual(sent({ selected: 12, layerNames: NAMES }), ["in Main · 12 layers"]);
  assert.deepEqual(sent({ selected: 0, layerNames: [] }), ["in Main"]);
});

test("a message sent with no composition open has no caption", () => {
  const harness = createPanelHarness({ sidecar: withFocus(null) });
  harness.send("hello");
  assert.deepEqual(captions(harness), []);
  assert.equal(storedContext(harness, 0) ?? null, null);
});

test("the stored message carries the context it was sent with", () => {
  const harness = createPanelHarness({ sidecar: withFocus({ selected: 12, layerNames: [...NAMES, "I", "J"] }) });
  harness.send("hello");
  const puts = harness.requests.filter((record) => record.method === "PUT" && record.url.includes("/v1/ui/sessions/"));
  assert.ok(puts.length > 0);
  const saved = recordOf(readJson(required(puts.at(-1)).body));
  assert.deepEqual(
    fieldOf(saved, "messages", 0, "context"),
    { composition: "Main", layers: NAMES, selected: 12 },
    "at most eight names are kept",
  );
  assert.equal(fieldOf(saved, "messages", 0, "text"), "hello");
});

test("a chat opened again shows the caption from the stored context", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      const message = { kind: "user", text: "hi", at: 1, context: { composition: "Main", layers: ["TITLE"], selected: 1 } };
      sidecar.sessions.set("s1", { id: "s1", title: "hi", project: null, createdAt: 1, updatedAt: 1, messages: [message] });
      sidecar.current = "s1";
    },
  });
  assert.deepEqual(captions(harness), ["in Main · TITLE"]);
});

test("the chip stays plain until the selection changes during a turn, then marks itself changed", () => {
  const harness = runningTurn();
  assert.equal(chip(harness).getAttribute("data-changed"), "false");
  harness.sse("focus", { focus: focusPayload({ at: 99 }) });
  assert.equal(chip(harness).getAttribute("data-changed"), "false", "the same selection is not a change");
  harness.sse("focus", { focus: focusPayload({ selected: 2, layerNames: ["LOGO", "TITLE"] }) });
  assert.equal(chip(harness).getAttribute("data-changed"), "true");
  assert.equal(chipText(harness), "Main · 2 layers", "the chip shows the live selection");
});

test("moving back to the selection the turn started with clears the mark", () => {
  const harness = runningTurn();
  harness.sse("focus", { focus: focusPayload({ layerNames: ["LOGO"] }) });
  assert.equal(chip(harness).getAttribute("data-changed"), "true");
  harness.sse("focus", { focus: focusPayload() });
  assert.equal(chip(harness).getAttribute("data-changed"), "false");
});

test("a change of composition during a turn marks the chip too", () => {
  const harness = runningTurn();
  harness.sse("focus", { focus: focusPayload({ compositionId: "c2", compositionName: "Outro" }) });
  assert.equal(chip(harness).getAttribute("data-changed"), "true");
});

test("the changed mark clears when the turn ends, and the next message uses the new selection", () => {
  const harness = runningTurn();
  harness.sse("focus", { focus: focusPayload({ selected: 2, layerNames: ["LOGO", "TITLE"] }) });
  assert.equal(chip(harness).getAttribute("data-changed"), "true");
  finishTurn(harness);
  assert.equal(chip(harness).getAttribute("data-changed"), "false");
  harness.send("and now this");
  assert.deepEqual(captions(harness), ["in Main · TITLE", "in Main · 2 layers"], "the first message keeps what it was sent with");
  assert.deepEqual(fieldOf(storedContext(harness, 0), "layers"), ["TITLE"]);
  assert.deepEqual(storedContext(harness, 2), { composition: "Main", layers: ["LOGO", "TITLE"], selected: 2 });
});

test("a selection change while no turn is running never marks the chip", () => {
  const harness = createPanelHarness({ sidecar: withFocus({}) });
  harness.sse("focus", { focus: focusPayload({ selected: 0, layerNames: [] }) });
  assert.equal(chip(harness).getAttribute("data-changed"), "false");
});

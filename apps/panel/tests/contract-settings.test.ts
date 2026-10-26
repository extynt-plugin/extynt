/** Panel contract: Settings as one page of accordion rows: Approvals (a radio list), Preferences (the toggles), Agents, and saving the provider. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { StubElement } from "./contract-dom.js";
import { chatBodies, chatResponder, element, noticeTexts, nth, required, textsOf } from "./contract-helpers.js";
import { NATIVE, createPanelHarness, type PanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { fieldOf, readJson, recordAt } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const html = readFileSync("apps/panel/index.html", "utf8");
const radios = (harness: PanelHarness): StubElement[] =>
  harness.body().all((node) => node.tagName === "INPUT" && node.type === "radio" && node.getAttribute("name") === "ask-before-applying");
const rows = (harness: PanelHarness): StubElement[] => harness.body().all((node) => node.classList.has("ask-choice"));
const chosen = (harness: PanelHarness): string[] =>
  radios(harness)
    .filter((node) => node.checked)
    .map((node) => node.value);
const pick = (harness: PanelHarness, id: string): void => {
  const radio = required(radios(harness).find((node) => node.value === id));
  radio.checked = true;
  radio.dispatch("change");
};
const pillOf = (harness: PanelHarness): string => element(harness, "approvals-state").textContent;
const prefPatches = (harness: PanelHarness): JsonObject[] =>
  harness.requests
    .filter((record) => record.method === "PATCH" && record.url.endsWith("/v1/ui/prefs"))
    .map((record) => recordAt(readJson(record.body)));
const refusePrefs = (record: StubRequestRecord): StubResponse | undefined =>
  record.method === "PATCH" ? { status: 500, text: JSON.stringify({ ok: false }) } : undefined;
const checkbox = (harness: PanelHarness, id: string): StubElement => element(harness, id);
const TOGGLES = ["show-thumbnails", "suggest-prompts", "rate-limit-enabled"];

test("Approvals is a vertical radio list: one native radio per choice, with the heading and the MCP note", () => {
  const harness = createPanelHarness();
  assert.deepEqual(
    radios(harness).map((node) => node.value),
    ["risky", "always", "never"],
  );
  assert.deepEqual(
    rows(harness).map((node) => required(node.find((child) => child.classList.has("ask-title"))).textContent),
    ["Only for risky changesRecommended", "Before every change", "Never ask"],
  );
  assert.deepEqual(
    rows(harness).map((node) => required(node.find((child) => child.classList.has("ask-note"))).textContent),
    [
      "Changes you can undo apply right away. Deleting your work, rendering and importing wait for your OK.",
      "Nothing changes until you click Apply.",
      "Changes apply as soon as they're proposed. You can still undo each one from the sheet.",
    ],
  );
  assert.deepEqual(chosen(harness), ["risky"], "risky is the default");
  assert.equal(
    harness.body().find((node) => node.tagName === "H3" && node.textContent === "When should extynt ask before changing your project?") !==
      null,
    true,
  );
  assert.match(harness.body().textContent, /AI agents connected over MCP follow their own app's approval setting\./);
  assert.equal(harness.el("auto-apply"), null, "no checkbox is left in the page: one control, not a toggle beside a preference");
  assert.equal(pillOf(harness), "Risky changes");
});

test("the approval pill names the current choice", () => {
  const expected: Record<string, string> = { risky: "Risky changes", always: "Every change", never: "Never" };
  for (const id of Object.keys(expected)) {
    const harness = createPanelHarness({
      sidecar: (sidecar) => {
        sidecar.prefs.askBeforeApplying = id;
      },
    });
    assert.deepEqual(chosen(harness), [id]);
    assert.equal(pillOf(harness), expected[id], id);
  }
});

test("the radio list shows what the sidecar has saved", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.prefs.askBeforeApplying = "never";
    },
  });
  assert.deepEqual(chosen(harness), ["never"]);
  assert.match(harness.body().textContent, /Changes apply as soon as they're proposed\./);
});

test("picking a choice saves it, shows it at once, and the next message is sent with it", () => {
  const harness = createPanelHarness({
    respond: (record) => (record.method === "PATCH" ? { hold: true } : chatResponder(() => ({ answer: "ok" }))(record)),
  });
  pick(harness, "always");
  assert.deepEqual(prefPatches(harness), [{ askBeforeApplying: "always" }]);
  assert.deepEqual(chosen(harness), ["always"], "shown before the sidecar has answered");
  assert.equal(pillOf(harness), "Every change");
  harness.send("fade it in");
  assert.equal(fieldOf(nth(chatBodies(harness), 0), "autoApply"), false);
});

test("a choice the sidecar refuses goes back to what was saved, and says so", () => {
  const harness = createPanelHarness({ respond: refusePrefs });
  pick(harness, "never");
  assert.deepEqual(chosen(harness), ["risky"]);
  assert.ok(noticeTexts(harness).includes("A setting could not be saved."));
});

test("the toggles show the saved preferences", () => {
  const off = createPanelHarness({
    sidecar: (sidecar) => {
      Object.assign(sidecar.prefs, { suggestPrompts: false, showThumbnails: false, rateLimit: false });
    },
  });
  assert.deepEqual(
    TOGGLES.map((id) => checkbox(off, id).checked),
    [false, false, false],
  );
  const on = createPanelHarness();
  assert.deepEqual(
    TOGGLES.map((id) => checkbox(on, id).checked),
    [true, true, true],
  );
});

test("the toggles live in Preferences, a row of their own right after Approvals", () => {
  const frames = html.slice(html.indexOf('id="frames-section"'), html.indexOf('id="memory-section"'));
  const approvals = html.slice(html.indexOf('id="approvals-section"'), html.indexOf('id="frames-section"'));
  for (const id of TOGGLES) {
    assert.ok(frames.includes('id="' + id + '"'), id + " is in Preferences");
    assert.equal(approvals.includes('id="' + id + '"'), false, id + " is not in Approvals");
  }
  assert.match(html, /<span class="acc-name" data-i18n="settings.frames.name">Preferences<\/span>/);
  assert.ok(html.indexOf('id="approvals-section"') < html.indexOf('id="frames-section"'), "after Approvals");
  const harness = createPanelHarness();
  assert.equal(element(harness, "frames-state").textContent, "All on");
  const off = createPanelHarness({
    sidecar: (sidecar) => {
      Object.assign(sidecar.prefs, { suggestPrompts: false, rateLimit: false });
    },
  });
  assert.equal(element(off, "frames-state").textContent, "2 off");
});

test("Settings is an accordion: one row open at a time, each with its state in one line", () => {
  const harness = createPanelHarness();
  harness.click("open-settings");
  const bodies = (): string[] =>
    ["about", "model", "decision", "approvals", "frames", "memory", "agents"].filter(
      (name) => required(harness.el("acc-" + name + "-body")).hidden === false,
    );
  assert.deepEqual(bodies(), [], "every row starts closed");
  harness.click("acc-approvals");
  assert.deepEqual(bodies(), ["approvals"]);
  assert.equal(element(harness, "acc-approvals").getAttribute("aria-expanded"), "true");
  harness.click("acc-model");
  assert.deepEqual(bodies(), ["model"], "opening another closes the first");
  harness.click("acc-model");
  assert.deepEqual(bodies(), []);
  assert.equal(element(harness, "model-state").textContent, "DeepSeek · key configured");
});

test("Provider & keys replaces Model: no model choice, no effort, and the way to the composer's picker is said in words", () => {
  assert.match(html, /<span class="acc-name" data-i18n="settings.model.name">Provider &amp; keys<\/span>/);
  assert.doesNotMatch(html, /<h2>Model/);
  assert.match(html, /Which model and effort to use is chosen next to the message box, not here\./);
});

test("Agents is a row of its own in Settings with the setup, and no live agent state: that is the bar and the sheet", () => {
  assert.match(html, /<span class="acc-name" data-i18n="settings.agents.name">Agents<\/span>/);
  for (const id of ["agent-state", "agent-detail"]) assert.equal(html.includes('id="' + id + '"'), false, id);
  const harness = createPanelHarness();
  harness.click("open-settings");
  const before = harness.requestsTo("/health").length;
  harness.click("page-back");
  harness.click("open-settings");
  assert.equal(harness.requestsTo("/health").length, before, "showing Settings does not read agent state");
  assert.doesNotMatch(html, /Advanced/);
});

test("the Agents setup is generic: no Claude-specific commands or client names", () => {
  assert.doesNotMatch(html, /claude mcp add|Claude Code|Claude Desktop/);
});

test("on macOS the Agents setup never mentions the Windows launcher", () => {
  const harness = createPanelHarness();
  const prompt = element(harness, "mcp-prompt").value;
  element(harness, "mcp-json").click();
  assert.doesNotMatch(prompt + element(harness, "mcp-json-block").textContent, /LOCALAPPDATA|ProgramData|cmd|Ctrl\+C/);
});

test("no Mac-only wording reaches the page for Windows users", () => {
  assert.doesNotMatch(html, /Finder/);
});

test("Copy prompt puts the setup prompt on the clipboard and says so for a moment", () => {
  const harness = createPanelHarness();
  harness.click("mcp-copy-prompt");
  assert.deepEqual(harness.clipboard, [element(harness, "mcp-prompt").value]);
  assert.match(nth(harness.clipboard, 0), /^Set up extynt as an MCP server/m);
  assert.match(nth(harness.clipboard, 0), /^Command: sh$/m);
  assert.equal(element(harness, "mcp-copy-prompt").textContent, "Copied");
  harness.runTimeouts((timer) => timer.ms === 2500);
  assert.equal(element(harness, "mcp-copy-prompt").textContent, "Copy prompt");
});

test("Show MCP config reveals a generic mcpServers config and Hide takes it away", () => {
  const harness = createPanelHarness();
  const block = element(harness, "mcp-json-block"),
    toggle = element(harness, "mcp-json");
  assert.equal(block.hidden, true);
  toggle.click();
  assert.equal(block.hidden, false);
  assert.equal(toggle.textContent, "Hide MCP config");
  assert.deepEqual(fieldOf(readJson(nth(block.textContent.split("\n\n"), 0)), "mcpServers", "extynt", "command"), "sh");
  toggle.click();
  assert.deepEqual([block.hidden, toggle.textContent], [true, "Show MCP config"]);
});

test("on Windows the prompt and the config use the cmd launcher", () => {
  const harness = createPanelHarness({ native: { ...NATIVE, platform: "windows" } });
  const prompt = element(harness, "mcp-prompt").value;
  assert.match(prompt, /^Command: cmd$/m);
  assert.match(prompt, /^Arguments: \["\/c","%ProgramData%\\\\extynt\\\\bin\\\\extynt-mcp\.cmd"\]$/m);
  assert.match(prompt, /^1\. Use the command and arguments exactly as written; cmd expands %ProgramData% itself\.$/m);
  element(harness, "mcp-json").click();
  const block = element(harness, "mcp-json-block").textContent;
  const config = readJson(nth(block.split("\n\n"), 0));
  assert.deepEqual(fieldOf(config, "mcpServers", "extynt", "command"), "cmd");
  assert.deepEqual(fieldOf(config, "mcpServers", "extynt", "args"), ["/c", "%ProgramData%\\extynt\\bin\\extynt-mcp.cmd"]);
  assert.match(block, /Works as written: cmd expands %ProgramData% when the agent starts it\./);
  assert.doesNotMatch(block + prompt, /YOU|AppData\\Local\\extynt|Library|Application Support|⌘/);
});

test("the Connection subsection is gone from Settings", () => {
  for (const id of ["reset-panel", "connection-summary", "collection-index", "probe"])
    assert.equal(html.includes('id="' + id + '"'), false, id);
});

const testBodies = (harness: PanelHarness): JsonValue[] =>
  harness.requestsTo("/v1/settings/model/test").map((record) => readJson(record.body));

test("Save posts the model slots, then tests the model on its own and lists the result", () => {
  const harness = createPanelHarness();
  harness.click("model-save");
  const save = required(harness.requests.find((record) => record.method === "POST" && record.url.endsWith("/v1/settings/model")));
  const body = recordAt(readJson(save.body));
  assert.equal(fieldOf(body, "primary", "service"), "deepseek");
  assert.equal(fieldOf(body, "primary", "format"), undefined, "the API format follows the service; there is no control for it");
  assert.ok("fallback" in body, "both slots are in the request");
  assert.deepEqual(testBodies(harness), [{ slot: "primary" }]);
  const status = element(harness, "model-status");
  assert.deepEqual(textsOf(status, "status-row"), ["DeepSeek · deepseek-v4 answered in 0.4 s"]);
  assert.match(status.className, /\bok\b/);
});

test("a model that does not answer shows the failure in the result rows", () => {
  const harness = createPanelHarness({
    respond: (record) =>
      record.url.endsWith("/v1/settings/model/test")
        ? { status: 200, text: JSON.stringify({ ok: false, error: { message: "401 from the provider." } }) }
        : undefined,
  });
  harness.click("model-save");
  assert.deepEqual(textsOf(element(harness, "model-status"), "status-row"), ["401 from the provider."]);
  assert.match(element(harness, "model-status").className, /\bbad\b/);
  assert.equal(element(harness, "model-save").disabled, false);
});

test("Test alone re-runs just the test without saving", () => {
  const harness = createPanelHarness();
  harness.click("model-test");
  assert.equal(harness.requests.filter((record) => record.method === "POST" && record.url.endsWith("/v1/settings/model")).length, 0);
  assert.deepEqual(testBodies(harness), [{ slot: "primary" }]);
});

test("a save the sidecar refuses reports it and does not test", () => {
  const refuse = (record: StubRequestRecord): StubResponse | undefined =>
    record.method === "POST" && record.url.endsWith("/v1/settings/model")
      ? { status: 400, text: JSON.stringify({ ok: false, error: { message: "Bad key." } }) }
      : undefined;
  const harness = createPanelHarness({ respond: refuse });
  harness.click("model-save");
  assert.equal(element(harness, "model-status").textContent, "Bad key.");
  assert.equal(testBodies(harness).length, 0);
});

test("a named service keeps its fixed address: its Address is hidden and the save carries none", () => {
  const harness = createPanelHarness();
  const addressLabel = nth(
    element(harness, "model-primary").all((node) => node.tagName === "LABEL" && node.textContent === "Address"),
    0,
  );
  assert.equal(addressLabel.hidden, true, "DeepSeek is selected, and its address is not typed");
  harness.click("model-save");
  const save = required(harness.requests.find((record) => record.method === "POST" && record.url.endsWith("/v1/settings/model")));
  assert.equal(fieldOf(recordAt(readJson(save.body)), "primary", "baseUrl"), undefined);
});

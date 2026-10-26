/**
 * Panel contract: the variant question. When the agent offers values for one control the sheet's Waiting section shows the
 * question and a tile for each option (a picture when the sidecar sent one, the model's label and value), read-only content that
 * can only be marked; the amber status bar holds the one confirm, "Use <label>", and "None of these". A press is sent once and the
 * bar waits; the sidecar leaves one ordinary plan, which waits for the user's Apply in the same bar. Nothing is applied before a press.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PNG, StubElement, createPanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { allButtonsFor, bar, barButton, bodyOf, element, folds, noticeTexts, nth, openSheet, planRow, required, toolCalls } from "./contract-helpers.js";
import { type JsonObject } from "@extynt/decode";
import { fieldOf, recordsAt } from "./json-narrow.js";

type Json = JsonObject;
const SET: Json = {
  setId: "variants-1",
  status: "open",
  reason: null,
  question: "How strong should the blur be?",
  currentValue: 12,
  createdAt: "2026-10-03T10:00:00.000Z",
  stale: false,
  names: { composition: "Main", layer: "Title", effect: "Gaussian Blur", control: "Blurriness" },
  target: {
    compositionId: "comp-1",
    layerId: "layer-1",
    effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2",
    propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001",
    effectMatchName: "ADBE Gaussian Blur 2",
  },
  candidates: [
    { index: 0, label: "subtler", value: 6, current: false },
    { index: 1, label: "current", value: 12, current: true },
    { index: 2, label: "stronger", value: 18, current: false },
  ],
  composition: {
    id: "comp-1",
    name: "Main",
    width: 64,
    height: 36,
    duration: 10,
    frameRate: 25,
    currentTime: 1.5,
    backgroundColor: [0, 0, 0],
  },
};
const OPTION_ROWS = [
  planRow("plan-a", { summary: "Blurriness to 6", variantSetId: "variants-1" }),
  planRow("plan-c", { summary: "Blurriness to 18", variantSetId: "variants-1" }),
];
const PICKED_PLAN = {
  planId: "plan-c",
  title: "Blurriness on Title to 18 (stronger)",
  operations: ["set_effect_control"],
  warnings: [],
  notices: [],
  expressions: [],
};
const CHANGE = { seq: 1, reason: "state", planId: null };

const ok = (extra: Json): StubResponse => ({ status: 200, text: JSON.stringify({ ok: true, ...extra }) });
const refusal = (status: number, code: string, message: string): StubResponse => ({
  status,
  text: JSON.stringify({ ok: false, error: { code, message } }),
});

interface Sidecar {
  sets: Json[];
  choices: Json[];
  choose: (body: Json) => StubResponse;
}
function pictured(candidate: Json, picture: string | undefined): Json {
  return picture === undefined ? candidate : { ...candidate, picture };
}
const choosing = (body: Json): StubResponse =>
  fieldOf(body, "choice") === 2
    ? ok({ outcome: "picked", set: { ...SET, status: "picked" }, plan: PICKED_PLAN })
    : fieldOf(body, "choice") === 1
      ? ok({ outcome: "kept_current", set: { ...SET, status: "picked" } })
      : ok({ outcome: "dismissed", set: { ...SET, status: "dismissed" } });

function world(partial: Partial<Sidecar> = {}, options: { holdChat?: boolean; holdChoose?: boolean } = {}) {
  const sidecar: Sidecar = { sets: [SET], choices: [], choose: choosing, ...partial };
  const harness = createPanelHarness({
    sidecar: (fake) => {
      fake.plans = OPTION_ROWS.map((row) => ({ ...row }));
    },
    respond: (record: StubRequestRecord) => {
      if (record.url.endsWith("/v1/variants/choose")) {
        sidecar.choices.push(bodyOf(record));
        return options.holdChoose ? { hold: true } : sidecar.choose(bodyOf(record));
      }
      if (record.url.endsWith("/v1/variants")) return ok({ sets: sidecar.sets });
      if (record.url.endsWith("/v1/chat") && record.method === "POST") return options.holdChat ? { hold: true } : undefined;
      return undefined;
    },
  });
  return { harness, sidecar };
}
type World = ReturnType<typeof world>;

const read = (w: World): boolean => w.harness.sse("change", CHANGE);
const has = (node: StubElement, name: string): boolean => node.className.split(" ").includes(name);
const item = (w: World): StubElement => {
  const found = openSheet(w.harness).find((node) => has(node, "sheet-item"));
  assert.ok(found, "the question is in the sheet's Waiting section");
  return found;
};
const items = (w: World): StubElement[] => openSheet(w.harness).all((node) => has(node, "sheet-item"));
const tiles = (node: StubElement): StubElement[] => node.all((candidate) => has(candidate, "variant-tile"));
const images = (node: StubElement): StubElement[] => node.all((candidate) => candidate.tagName === "IMG");
const variantReads = (w: World): number =>
  w.harness.requestsTo("/v1/variants").filter((record) => record.method === "GET" && !record.url.includes("/choose")).length;
const useButton = (w: World): StubElement => required(barButton(w.harness, "use-variant"));
const noneButton = (w: World): StubElement => required(barButton(w.harness, "variant-none"));
const barDisabled = (w: World): boolean[] => [useButton(w), noneButton(w)].map((button) => button.disabled);

test("a set the sidecar names is a question in the sheet and an amber bar: the question, a tile each, Use <label> and None of these", () => {
  const w = world({ sets: [SET] });
  read(w);
  const view = bar(w.harness);
  assert.deepEqual(
    [view.state, view.tone, view.text, view.sub, view.actions],
    ["needs-you", "amber", "How strong should the blur be?", "3 options, tiles in the sheet", ["Use subtler", "None of these"]],
  );
  const node = item(w);
  assert.deepEqual(
    tiles(node).map((tile) => tile.textContent),
    ["subtler6", "current12 · current", "stronger18"],
    "label then value, the current one marked",
  );
  assert.equal(
    node.all((candidate) => candidate.tagName === "BUTTON" && candidate.textContent === "Use this").length,
    0,
    "no per-tile Use this: the confirm is the bar's",
  );
  assert.equal(allButtonsFor(w.harness, "None of these").length, 1);
  read(w);
  assert.equal(items(w).length, 1, "reading again does not add it twice");
});

test("the sets are read when the sidecar reports a change and at boot, not on a timer", () => {
  const w = world();
  const boot = variantReads(w);
  assert.equal(boot, 1, "boot reads the sets once so a reloaded panel shows an open question");
  w.harness.runIntervals((timer) => timer.ms !== 15000 && timer.ms !== 5000 && timer.ms !== 10000);
  assert.equal(variantReads(w), boot);
  read(w);
  assert.equal(variantReads(w), boot + 1);
});

test("a question the model did not write is replaced by what is being chosen, from the project's own names", () => {
  const w = world({ sets: [{ ...SET, question: null }] });
  read(w);
  assert.match(bar(w.harness).text, /^Pick a value for “Blurriness” on “Title”/);
});

test("a candidate's own picture is shown on its tile; the panel makes no pictures itself", () => {
  const withPictures = (urls: Array<string | undefined>): Json[] => [
    { ...SET, candidates: recordsAt(SET, "candidates").map((candidate, index) => pictured(candidate, urls[index])) },
  ];
  const w = world({ sets: withPictures([PNG, undefined, PNG]) });
  read(w);
  assert.equal(images(item(w)).length, 2, "only the options the sidecar pictured have a picture");
  assert.equal(nth(images(item(w)), 0).src, PNG);
  assert.equal(nth(images(item(w)), 0).alt, "Preview of subtler");
  const plain = world({ sets: withPictures(["https://elsewhere.example/a.png", "not an image", undefined]) });
  read(plain);
  assert.equal(images(item(plain)).length, 0, "anything that is not an image data URL is never put in the page");
});

test("pictures that arrive on a later read fill the tiles of the question already shown", () => {
  const w = world();
  read(w);
  assert.equal(images(item(w)).length, 0);
  w.sidecar.sets = [{ ...SET, candidates: recordsAt(SET, "candidates").map((candidate) => pictured(candidate, PNG)) }];
  read(w);
  assert.equal(items(w).length, 1);
  assert.equal(images(item(w)).length, 3);
});

test("nothing is applied, approved or chosen by the question appearing, even with the default ask-before-applying", () => {
  const w = world();
  read(w);
  read(w);
  assert.equal(toolCalls(w.harness, "ae_approve_plan").length, 0, "no approval");
  assert.equal(w.sidecar.choices.length, 0);
  assert.deepEqual(
    w.harness.requests
      .filter((record) => record.method === "POST")
      .map((record) => record.url)
      .filter((url) => url.includes("/v1/variants") && !url.endsWith("/preview")),
    [],
    "the panel only reads the sets and asks for pictures",
  );
});

test("the options are not plans waiting for approval: no notice, no Apply, no row of their own in Waiting", () => {
  const w = world();
  read(w);
  read(w);
  assert.doesNotMatch(w.harness.body().textContent, /proposed:/, "no notice about a plan from elsewhere");
  assert.equal(items(w).length, 1, "the question is the one thing waiting: not one row per option plan");
  assert.equal(allButtonsFor(w.harness, "Apply").length, 0);
  w.harness.sidecar.plans.push(planRow("plan-x", { summary: "A real plan", source: "Codex" }));
  read(w);
  assert.equal(items(w).length, 2, "while an ordinary plan does count");
  assert.equal(required(element(w.harness, "status-bar").find((node) => has(node, "bar-step"))).textContent, "1 of 2");
});

test("marking a tile only chooses what the confirm will use; Use <label> sends the pick once and the bar waits", () => {
  const w = world({}, { holdChoose: true });
  read(w);
  assert.equal(useButton(w).textContent, "Use subtler", "the first option that is not the current value is marked at the start");
  nth(tiles(item(w)), 2).click();
  assert.equal(w.sidecar.choices.length, 0, "marking sends nothing");
  assert.equal(useButton(w).textContent, "Use stronger");
  assert.equal(nth(tiles(item(w)), 2).getAttribute("aria-pressed"), "true");
  assert.equal(useButton(w).click(), true);
  assert.deepEqual(w.sidecar.choices, [{ setId: "variants-1", choice: 2 }], "one request, naming the set and the option");
  assert.deepEqual(barDisabled(w), [true, true], "the bar waits while the pick is out");
  assert.match(item(w).textContent, /Choosing…/);
  assert.equal(useButton(w).click(), false, "a disabled button sends nothing");
  assert.equal(noneButton(w).click(), false);
  nth(
    w.harness.held().filter((xhr) => xhr.url.endsWith("/v1/variants/choose")),
    0,
  ).respond(200, JSON.stringify({ ok: true, outcome: "picked", set: { ...SET, status: "picked" }, plan: PICKED_PLAN }));
  assert.equal(w.sidecar.choices.length, 1, "a second press sends nothing");
  assert.equal(
    bar(w.harness).text,
    "Apply “Blurriness on Title to 18 (stronger)”?",
    "the plan it leaves waits for the one Apply, in the same bar",
  );
  assert.equal(folds(w.harness).length, 1, "and the thread keeps its one fold line");
  assert.equal(toolCalls(w.harness, "ae_approve_plan").length, 0, "nothing is applied until the user presses Apply");
});

test("the plan a pick leaves is applied through the ordinary Apply of the bar", () => {
  const w = world();
  read(w);
  nth(tiles(item(w)), 2).click();
  useButton(w).click();
  required(barButton(w.harness, "apply")).click();
  assert.deepEqual(
    toolCalls(w.harness, "ae_approve_plan").map((call) => fieldOf(call, "planId")),
    ["plan-c"],
  );
  assert.match(nth(folds(w.harness), 0).textContent, /verified/);
});

test("None of these sends one answer, applies nothing and the question goes", () => {
  const w = world();
  read(w);
  noneButton(w).click();
  assert.deepEqual(w.sidecar.choices, [{ setId: "variants-1", choice: "none" }]);
  assert.equal(bar(w.harness).state, "idle");
  assert.equal(items(w).length, 0);
  assert.equal(toolCalls(w.harness, "ae_approve_plan").length, 0);
  assert.equal(folds(w.harness).length, 0, "no plan appears");
});

test("choosing the current value changes nothing", () => {
  const w = world();
  read(w);
  nth(tiles(item(w)), 1).click();
  assert.equal(useButton(w).textContent, "Use current");
  useButton(w).click();
  assert.deepEqual(w.sidecar.choices, [{ setId: "variants-1", choice: 1 }]);
  assert.equal(folds(w.harness).length, 0);
  assert.equal(bar(w.harness).state, "idle");
});

test("a refusal because the project changed is told in the sidecar's plain words, ends the question, and applies nothing", () => {
  const message =
    "The project changed after these options were offered, so none of them can be applied safely. Nothing was changed. Ask for them again.";
  const w = world({ choose: () => refusal(409, "VARIANT_SET_STALE", message) });
  read(w);
  useButton(w).click();
  assert.ok(noticeTexts(w.harness).includes(message), "the refusal reaches the user in words");
  assert.doesNotMatch(w.harness.body().textContent, /VARIANT_|409/, "no code reaches the user");
  assert.equal(items(w).length, 0, "a closed set offers nothing more");
  assert.equal(bar(w.harness).state, "idle");
  assert.deepEqual([toolCalls(w.harness, "ae_approve_plan").length, w.sidecar.choices.length], [0, 1]);
});

test("a refusal that does not end the question gives the bar back, so the user can try again", () => {
  let attempts = 0;
  const w = world({
    choose: () =>
      (attempts += 1) === 1
        ? refusal(
            409,
            "NO_SNAPSHOT",
            "After Effects has not reported the project yet, so these options cannot be checked against it. Try again in a moment.",
          )
        : ok({ outcome: "dismissed", set: { ...SET, status: "dismissed" } }),
  });
  read(w);
  noneButton(w).click();
  assert.match(bar(w.harness).sub, /Try again in a moment/);
  assert.deepEqual(barDisabled(w), [false, false]);
  noneButton(w).click();
  assert.equal(bar(w.harness).state, "idle");
  assert.equal(w.sidecar.choices.length, 2);
});

test("an unreachable sidecar is said plainly, never as a code, and the bar is given back", () => {
  const w = world({ choose: () => ({ status: 503, text: "{}" }) });
  read(w);
  useButton(w).click();
  assert.match(bar(w.harness).sub, /That did not go through, and nothing was changed\. Try again\./);
  assert.deepEqual(barDisabled(w), [false, false]);
});

test("a set closed elsewhere stops being asked about the next time the sets are read", () => {
  const w = world();
  read(w);
  assert.equal(bar(w.harness).state, "needs-you");
  w.sidecar.sets = [{ ...SET, status: "dismissed", reason: "superseded" }];
  read(w);
  assert.equal(bar(w.harness).state, "idle");
  assert.equal(items(w).length, 0);
});

test("a set that is not valid, or a sidecar that fails the read, draws nothing", () => {
  const broken = world({
    sets: [
      { ...SET, candidates: recordsAt(SET, "candidates").slice(0, 1) },
      { ...SET, setId: "variants-2", target: null },
    ],
  });
  read(broken);
  assert.equal(items(broken).length, 0, "fewer than two options, or no target: left out, never guessed at");
  const failing = createPanelHarness({
    respond: (record) => (record.url.endsWith("/v1/variants") ? { status: 503, text: "{}" } : undefined),
  });
  failing.sse("change", CHANGE);
  assert.equal(bar(failing).state, "idle");
});

test("a question that arrives during the agent's turn is shown at once, and the bar keeps its Stop", () => {
  const w = world({}, { holdChat: true });
  w.harness.send("make the blur subtler");
  read(w);
  assert.equal(bar(w.harness).state, "needs-you");
  assert.deepEqual(bar(w.harness).actions, ["Stop", "Use subtler", "None of these"]);
  assert.equal(allButtonsFor(w.harness, "Stop").length, 1);
});

const previewPosts = (w: World): StubRequestRecord[] =>
  w.harness.requests.filter((record) => record.method === "POST" && record.url.endsWith("/v1/variants/variants-1/preview"));

test("an open set's options are pictured by the host lane: one preview ask per set, and the pictures fill the tiles", () => {
  const pictures = { status: "ready", pictures: { 0: PNG, 2: PNG } };
  const sidecar: Sidecar = { sets: [SET], choices: [], choose: choosing };
  const harness = createPanelHarness({
    respond: (record) =>
      record.url.endsWith("/v1/variants/choose")
        ? sidecar.choose(bodyOf(record))
        : record.url.endsWith("/v1/variants")
          ? ok({ sets: sidecar.sets })
          : record.url.endsWith("/preview")
            ? ok(pictures)
            : undefined,
  });
  const w: World = { harness, sidecar };
  read(w);
  read(w);
  assert.equal(previewPosts(w).length, 1, "asked once however many times the sets are read");
  assert.equal(images(item(w)).length, 2);
});

test("a preview event asks the sidecar for the pictures again, which it answers from its store", () => {
  const w = world();
  read(w);
  assert.equal(previewPosts(w).length, 1);
  w.harness.sse("preview", { setId: "variants-1" });
  assert.equal(previewPosts(w).length, 2);
});

test("with Before/after frames off the panel asks for no pictures", () => {
  const sidecar: Sidecar = { sets: [SET], choices: [], choose: choosing };
  const harness = createPanelHarness({
    sidecar: (fake) => {
      fake.prefs.showThumbnails = false;
    },
    respond: (record) => (record.url.endsWith("/v1/variants") ? ok({ sets: sidecar.sets }) : undefined),
  });
  const w: World = { harness, sidecar };
  read(w);
  assert.equal(items(w).length, 1);
  assert.equal(previewPosts(w).length, 0);
});

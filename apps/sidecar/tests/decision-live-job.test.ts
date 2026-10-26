// Live check of the job-open batch against the real Jev: each request is one batch, and the seams that read the booked answers give the expected parts, names, scene, evidence kinds, layer-style reading and scale.
import test, { beforeEach, describe } from "node:test";
import type { FeatureId } from "@extynt/decide";
import { clearBook } from "../src/decision-book.js";
import { primeJobOpen } from "../src/decision-prime.js";
import { decideSceneRequest } from "../src/build-kit.js";
import { decideLayerStyleRequest } from "../src/layer-style-request.js";
import { decideNameAsk, requestedFeatures } from "../src/request-coverage.js";
import { requestScale } from "../src/server-workflow-checklist-model.js";
import { goalAsksForJudgement, requiredEvidenceKindsForGoal } from "../src/workflow-goal-evidence.js";
import { MockProvider } from "@extynt/llm";
import { specialistWithheld } from "../src/decision-specialists.js";
import { answersOnly } from "../src/server-chat-answer-only.js";
import { SKIP, Suite, liveService } from "./decision-live-support.js";
import { sidecarFor, token } from "./sidecar-fixture.js";

beforeEach(() => clearBook());

const opened = (request: string) => ({ request, message: request });

interface PartsCase { readonly request: string; readonly asked: ReadonlyArray<FeatureId>; readonly notAsked: ReadonlyArray<FeatureId> }

const PARTS: ReadonlyArray<PartsCase> = [
  { request: "Add a soft glow to the title", asked: ["glow"], notAsked: ["blur"] },
  { request: "Make the logo blurry but no glow please", asked: ["blur"], notAsked: ["glow"] },
  { request: "Füge dem Titel einen weichen Schein hinzu", asked: ["glow"], notAsked: ["blur", "drop-shadow"] },
  { request: "Create a null object and parent the title layer to it", asked: ["null", "parent"], notAsked: ["glow"] },
  { request: "Add a drop shadow to the text", asked: ["drop-shadow"], notAsked: ["glow", "blur"] },
  { request: "Haz que la capa tiemble con un wiggle", asked: ["wiggle"], notAsked: ["glow", "blur"] },
  { request: "Animate the text per character with a range selector and then dolly the camera in", asked: ["text-animator", "camera-move"], notAsked: ["glow"] },
];

describe("live request-parts at job open", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("job-open request-parts", live.meter, 0.85, live.rows);
  for (const { request, asked, notAsked } of PARTS) {
    test(`"${request}" asks for its parts and no others`, async () => {
      await primeJobOpen(live.service, opened(request));
      const ids = requestedFeatures(request).map((feature) => feature.id);
      suite.checkWhere(asked.every((id) => ids.includes(id)) && notAsked.every((id) => !ids.includes(id)), `${request} -> ${ids.join(",")}`);
    });
  }
  test("the request-parts suite is timed", () => { suite.finish(); });
});

describe("live named objects at job open", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("job-open named-object", live.meter, 0.79, live.rows);
  const CASES: ReadonlyArray<readonly [string, string, "asked" | "not-asked"]> = [
    ["Create a solid layer named HERO_TITLE and a null named CAM_RIG", "HERO_TITLE", "asked"],
    ["Create a solid layer named HERO_TITLE and a null named CAM_RIG", "CAM_RIG", "asked"],
    ["Keep the existing OLD_LOGO layer untouched and add a glow to the title", "OLD_LOGO", "not-asked"],
    ["Do not create FINAL_RENDER, just fix the title position", "FINAL_RENDER", "not-asked"],
    ["Lege eine Komposition namens INTRO_SHOT an", "INTRO_SHOT", "asked"],
  ];
  for (const [request, name, expected] of CASES) {
    test(`${name} in "${request}" is ${expected}`, async () => {
      await primeJobOpen(live.service, opened(request));
      suite.check(decideNameAsk({ goal: request, name, index: request.indexOf(name) }), expected, `${request} / ${name}`);
    });
  }
  test("the named-object suite is timed", () => { suite.finish(); });
});

describe("live drawn scene at job open", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("job-open drawn-scene", live.meter, 0.83, live.rows);
  const CASES: ReadonlyArray<readonly [string, "drawn-scene" | "arranged-layers"]> = [
    ["Draw a night sky with stars and a crescent moon", "drawn-scene"],
    ["Move the title to the left and fade it in", "arranged-layers"],
    ["Zeichne eine Berglandschaft bei Sonnenuntergang", "drawn-scene"],
    ["Make three lines of text slide in one after another", "arranged-layers"],
    ["Make a cartoon fox character sitting on a hill", "drawn-scene"],
    ["Put the logo in the corner and add a drop shadow", "arranged-layers"],
  ];
  for (const [request, expected] of CASES) {
    test(`"${request}" is read as ${expected}`, async () => {
      await primeJobOpen(live.service, opened(request));
      suite.check(decideSceneRequest({ request }), expected, request);
    });
  }
  test("the drawn-scene suite is timed", () => { suite.finish(); });
});

describe("live evidence kinds at job open", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("job-open evidence", live.meter, 0.83, live.rows);
  const CASES: ReadonlyArray<readonly [string, ReadonlyArray<string>, boolean]> = [
    ["Rename the layer to Title and move it into the Titles folder", [], false],
    ["Make the logo bounce in over one second", ["visual", "temporal"], false],
    ["Make this shot feel more cinematic", ["visual"], true],
    ["Set the composition frame rate to 30 and its duration to 10 seconds", [], false],
    ["Lass den Text von links einfliegen", ["visual", "temporal"], false],
    ["Match the look of the reference frame", ["visual"], true],
  ];
  for (const [request, kinds, judgement] of CASES) {
    test(`"${request}" needs ${kinds.join("+") || "no"} evidence and ${judgement ? "a" : "no"} judgement`, async () => {
      await primeJobOpen(live.service, opened(request));
      suite.check([requiredEvidenceKindsForGoal(request), goalAsksForJudgement(request)], [kinds, judgement], request);
    });
  }
  test("the evidence suite is timed", () => { suite.finish(); });
});

describe("live layer style and scale at job open", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("job-open layer-style and scale", live.meter, 0.79, live.rows);
  const STYLES: ReadonlyArray<readonly [string, "names-layer-style" | "does-not-name"]> = [
    ["Add a Layer Style drop shadow to the text", "names-layer-style"],
    ["Add a drop shadow to the text", "does-not-name"],
    ["Usa estilos de capa para dar una sombra al título", "names-layer-style"],
  ];
  for (const [message, expected] of STYLES) {
    test(`"${message}" is read as ${expected}`, async () => {
      await primeJobOpen(live.service, opened(message));
      suite.check(decideLayerStyleRequest({ message, workflowGoalSummary: message }), expected, message);
    });
  }
  const LONG = "Build a twenty second intro with three scenes: a logo reveal with a glow, a lower third that slides in with the name JANE_DOE, and an outro with scrolling credits, each with its own transition and a shared camera move";
  const SCALES: ReadonlyArray<readonly [string, "small" | "long"]> = [["Make the title glow", "small"], [LONG, "long"]];
  for (const [request, expected] of SCALES) {
    test(`a ${expected} request is read as ${expected}`, async () => {
      await primeJobOpen(live.service, opened(request));
      suite.check(requestScale(request), expected, request);
    });
  }
  test("the layer-style and scale suite is timed", () => { suite.finish(); });
});

describe("live route at job open", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("job-open route", live.meter, 0.79, live.rows);
  const sidecar = sidecarFor({ port: 0, token, chatProvider: new MockProvider(), decisionModels: () => live.meter.models, quietAgentLog: true });
  const CASES: ReadonlyArray<readonly [string, boolean]> = [
    ["How does a wiggle expression work in After Effects?", true],
    ["What is the difference between a null object and an adjustment layer?", true],
    ["Add a soft glow to the title and fade it in", false],
    ["Make the logo bounce in over one second", false],
    ["Zeichne eine Berglandschaft bei Sonnenuntergang", false],
  ];
  for (const [message, answerOnly] of CASES) {
    test(`"${message}" ${answerOnly ? "is answered without a job" : "is never answer-only"}`, async () => {
      suite.check(await answersOnly(sidecar, { message, history: [] }), answerOnly, message);
    });
  }
  test("the route suite is timed", () => { suite.finish(); });
});

describe("live specialists at job open", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("job-open specialists", live.meter, 0.5, live.rows);
  test("a plain one-property edit leaves the execution role in and withholds nothing it needs", async () => {
    const request = "Make the title glow";
    await primeJobOpen(live.service, opened(request));
    suite.check(specialistWithheld(request, "execution"), false, "execution is never withheld");
  });
  test("a request that needs no expression does not withhold the planner for a multi-part build", async () => {
    const request = "Build a twenty second intro with a logo reveal, a lower third and scrolling credits";
    await primeJobOpen(live.service, opened(request));
    suite.check(specialistWithheld(request, "planner"), false, request);
  });
  test("the specialists suite is timed", () => { suite.finish(); });
});

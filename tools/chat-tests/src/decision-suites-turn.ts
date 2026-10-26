// The suites over how a turn went: its ending, whether it answered a question, whether a frame is needed, how good a frame is, and the modal risk of an effect.
import { ENDED_IN_PROSE, FRAME_QUALITY, MODAL_RISK, QUESTION_ANSWERED, VISUAL_WAIVER } from "@extynt/decide";
import type { DrawnLayer } from "@extynt/decide";
import { specCase } from "./decision-eval-cases.js";
import { loadAnsweredCases, loadFixtureImage, loadFrameCases, loadModalCases, loadProseCases, loadWaiverCases, tagsOf } from "./decision-fixtures.js";
import type { SpecSuite } from "./decision-eval-types.js";

function boxOf(box: ReadonlyArray<number> | null): DrawnLayer["box"] {
  const [left, top, right, bottom] = box ?? [];
  return left === undefined || top === undefined || right === undefined || bottom === undefined ? null : [left, top, right, bottom];
}

/** The suites over how a turn went. */
export function turnSuites(): ReadonlyArray<SpecSuite> {
  return [
    { name: "ended-in-prose", cases: loadProseCases().cases.map(({ id, expected, lang, hard, ...state }) => specCase({ id, tags: tagsOf({ lang, hard }), spec: ENDED_IN_PROSE, state, expected })) },
    { name: "question-answered", cases: loadAnsweredCases().cases.map(({ id, expected, lang, hard, ...state }) => specCase({ id, tags: tagsOf({ lang, hard }), spec: QUESTION_ANSWERED, state, expected })) },
    { name: "visual-waiver", cases: loadWaiverCases().cases.map(({ id, expected, lang, hard, ...state }) => specCase({ id, tags: tagsOf({ lang, hard }), spec: VISUAL_WAIVER, state, expected })) },
    {
      name: "frame-quality",
      cases: loadFrameCases().cases.map((row) => specCase({
        id: row.id, tags: tagsOf(row), spec: FRAME_QUALITY, expected: row.level, ...(row.image === undefined ? {} : { image: loadFixtureImage(row.image) }),
        state: {
          request: row.request, width: row.width, height: row.height,
          layers: row.layers.map((layer) => ({ name: layer.name, text: layer.text, box: boxOf(layer.box) })),
        },
      })),
    },
    {
      name: "modal-risk",
      cases: loadModalCases().cases.map((row) => specCase({
        id: row.id, tags: tagsOf(row), spec: MODAL_RISK, expected: row.label,
        state: { matchName: row.matchName, displayName: row.displayName, hasOptionsDialog: row.hasOptionsDialog },
      })),
    },
  ];
}

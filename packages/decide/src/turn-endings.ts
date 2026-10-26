// How a model's turn ended: in prose that reports the work done, or with a question the user's own words answered; the two questions the cycle loop asks of a finished turn.
import { binary } from "./spec.js";
import type { BinarySpec } from "./spec.js";

/** What the prose-ending decision reads: the model's final words and the facts about how its turn ended. */
export type TurnEnd = {
  readonly answer: string;
  readonly sealed: boolean;
  readonly failed: boolean;
  readonly askedUser: boolean;
  readonly refused: boolean;
};

/** What the question-answered decision reads: the first cycle's final words and what the turn did. */
export type FirstCycle = {
  readonly answer: string;
  readonly askedUser: boolean;
  readonly cycle: number;
  readonly continuation: boolean;
  readonly authoredWork: boolean;
};

const ENDS_ASKING = /[?？]["'”’」』)）\s]*$/u;

function endsAsking(answer: string): boolean {
  return ENDS_ASKING.test(answer.trim());
}

/** Whether the owner's turn ended in its own words with nothing pending: no seal waiting on the host, no question, no failure, no admission refusal. */
export const ENDED_IN_PROSE: BinarySpec<TurnEnd> = binary<TurnEnd>({
  name: "ended-in-prose",
  instructions: "An assistant building a motion graphics request in After Effects finished a turn. The state holds its final words and facts about how the turn ended. Decide whether the turn ended in prose that reports on the work, with nothing else pending.",
  criteria: {
    true: "The turn ended with the assistant's own words reporting or summarising; it was not sealed, did not fail, asked the user nothing and was not refused.",
    false: "The turn was sealed and waits on the host, failed, asked the user a question, was refused, or has no words.",
  },
  deterministic: (state) => !state.sealed && !state.failed && !state.askedUser && !endsAsking(state.answer) && !state.refused && state.answer.trim().length > 0,
});

/** Whether the first cycle of a fresh request already answered it: the user asked a question and got an answer, rather than a job to build. */
export const QUESTION_ANSWERED: BinarySpec<FirstCycle> = binary<FirstCycle>({
  name: "question-answered",
  instructions: "A user sent a first message and an assistant ran its first cycle. The state holds the assistant's final words and what the cycle did. Decide whether the cycle answered a question, so there is no job left to build.",
  criteria: {
    true: "This is the first cycle of a new request and the assistant either asked the user something or answered in words without authoring any work.",
    false: "The cycle authored work, is a later cycle, continues an earlier run, or ended with no words and no question.",
  },
  deterministic: (state) => state.cycle === 0 && !state.continuation && (state.askedUser || (state.answer.trim().length > 0 && !state.authoredWork)),
});

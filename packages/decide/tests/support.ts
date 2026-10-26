// Shared test fixtures: a fake fetch that records requests, canned replies and the specs the suites decide over.
import type { HttpFetch, HttpReply, HttpRequest, JsonValue } from "../src/index.js";
import { binary, choice, labels, score } from "../src/index.js";

/** What a test's fake fetch saw. */
export interface Call {
  readonly url: string;
  readonly request: HttpRequest;
}

/** A reply with the given status and JSON body. */
export function jsonReply(status: number, body: JsonValue): HttpReply {
  return { status, text: async () => JSON.stringify(body) };
}

/** A reply with the given status and raw text body. */
export function textReply(status: number, body: string): HttpReply {
  return { status, text: async () => body };
}

/** A fetch that answers every call with the reply, or throws the error, and records each call. */
export function fakeFetch(answer: HttpReply | Error): { readonly fetch: HttpFetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, request) => {
    calls.push({ url, request });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, calls };
}

/** The state every fixture decision reads. */
export type Request = { readonly text: string };

export const FEATURE = choice({
  name: "feature",
  instructions: "Which feature does the request name?",
  labels: { glow: "a soft light bloom", blur: null, none: null },
  deterministic: (state: Request) => (state.text.includes("glow") ? "glow" : "none"),
});

const EFFECT_NAMES = ["glow", "blur"] as const;

export const EFFECTS = labels({
  name: "effects",
  instructions: "Which effects does the request name?",
  labels: { glow: null, blur: "softening of detail" },
  deterministic: (state: Request) => EFFECT_NAMES.filter((effect) => state.text.includes(effect)),
});

export const URGENCY = score({
  name: "urgency",
  instructions: "How urgent is the request?",
  levels: ["not urgent", "soon", "now"],
  deterministic: (state: Request) => (state.text.includes("now") ? 2 : 0),
});

export const IS_SCENE = binary({
  name: "scene",
  instructions: "Is the request a drawn scene?",
  deterministic: (state: Request) => state.text.includes("scene"),
});

/** A Jev-style reply holding the given answers by question id. */
export function answersReply(answers: JsonValue): HttpReply {
  return jsonReply(200, { model: "jev-latest", answers, usage: { input_tokens: 1, output_tokens: 1 }, request_id: "r1" });
}

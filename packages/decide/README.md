# @extynt/decide

Decision ports: each small fuzzy language decision in a program ("which effect does this request mean?", "is this a
drawn scene?", "is the job complete?") is declared once as a typed spec and answered by the best tier available.
Zero runtime dependencies besides `@extynt/decode`.

```ts
import { choice, binary, decideAll, decisionModelsFromEnvironment } from "@extynt/decide";

type Request = { readonly text: string };

const FEATURE = choice({
  name: "feature",
  instructions: "Which effect does the request name?",
  labels: { glow: "a soft bloom of light", blur: null, none: "no effect is named" },
  deterministic: (state: Request) => (/\bglow/i.test(state.text) ? "glow" : "none"),
});

const IS_SCENE = binary({
  name: "scene",
  instructions: "Is the request for a drawn scene?",
  deterministic: (state: Request) => /\bscene\b/i.test(state.text),
});

const models = decisionModelsFromEnvironment();
const { feature, scene } = await decideAll({ text: "draw a glowing sun" }, { feature: FEATURE, scene: IS_SCENE }, { models });
// feature.label is "glow" | "blur" | "none"; scene.value is a boolean.
// Both carry source ("decision-model" | "model" | "deterministic"), provider, calibrated and fallback.
```

A state is any JSON value, written as a type alias (not an interface) so it is known to be JSON.

## Decision kinds

| Kind | Declared with | Result |
| --- | --- | --- |
| choice | `choice({ labels, ... })`, 1 to 255 labels | `label`, `confidence`, `probabilities` |
| labels | `labels({ labels, ... })`, any number apply | `labels` (a set), `confidence`, `probabilities` |
| score | `score({ levels, ... })`, 2 to 10 ordered level descriptions | `level`, `expected`, `confidence`, `probabilities` |
| binary | `binary({ ... })` | `probability`, `value`, `confidence` |

Result types are inferred from the spec: a choice's `label` is the union of the spec's label keys.

A choice can name `guarded` labels that are costly to get wrong (for example answering a real edit request with text only). A model answer of a guarded
label is taken only in the act band; in the verify band the deterministic answer stands.

## Closed decisions shipped

Animation inputs: `propertyChoice(properties)`. Easing, strength, animate-or-set and direction are left to the agent's own plan, not decided here.
Orchestration: `REQUEST_ROUTE` (answer-only, single agent, specialist workflow; answer-only is guarded), `REQUEST_SPECIALISTS`, `MODEL_TIER`.
Review: `REVIEW_PROVEN` (do the receipts already prove the covered work, so the reviewer can skip its frame check; high stakes, acts only in the act band, no deterministic yes).
Each has a deterministic tier that matches today's behaviour. Numbers stay with the deterministic tier or the language model.

## Tiers

1. **Decision model.** A model built to answer decision questions: cheap, fast and many questions per request.
   `decideAll` sends every decision it can to the first configured decision model as one batch. A kind the model does
   not answer natively is mapped onto one it does (a multi-label decision becomes one yes or no question per label).
   If the call fails, times out (4 seconds by default), is refused, or answers with less confidence than the threshold,
   that decision falls to the next tier and the result says why in `fallback`.
2. **Model.** Your own language model through the `LanguageModelPort` interface, `languageDecisionModel(port)`.
   It costs a turn, so a decision opts in with `useModel: true`. The package does not depend on any provider.
   The reply is constrained by a JSON schema built from the questions (`replySchema`). A user's model is not
   calibrated, so it carries its own conservative `LANGUAGE_MODEL_BANDS` (verify 0.8, act 0.9) that replace the
   bands fitted to Jev. The sidecar turns this tier on with the chat model when no decision model is configured and
   the chat model supports structured output; only `drawn-scene` and `request-scale` opt in. Jev wins when present.
3. **Deterministic.** The pure function in the spec. It is always present, offline, and the final answer.

With no decision model configured nothing touches the network.

### Abstention

A spec may carry `deterministicConfidence(state, answer)` (0 to 1, default 1) and `abstainBelow`. When the offline answer
falls below the threshold the result keeps the same value but is marked `abstained`, lands in the `escalate` band and is
logged as unsure; callers that ignore bands see what they saw before. The candidate choosers (effect, control, font,
property) score by the margin over the runner-up and whether the phrase explained any query word; `REQUEST_PARTS` and
`REQUEST_SCALE` use feature counts and agreement. An abstained answer of a `stakes: "high"` spec is retried once on
a configured user-model tier even if the spec did not opt in with `useModel`; if that fails the offline answer stands.
`pnpm --filter @extynt/chat-tests` offline eval reports coverage and answered accuracy per suite, and `--stress` adds suites
whose wanted candidate is removed so the right answer is "none".

Live tests probe the key once per process (`liveSkipReason`) and skip, instead of failing, when it is missing, rejected (expired) or the server is unreachable. They run only under `pnpm test:live`, never in `pnpm test` or the gate.

## Enabling a decision model

Set `TYPESAFE_API_KEY` to enable TypeSafe AI's Jev (`TYPESAFE_BASE_URL` and `TYPESAFE_MODEL` are optional overrides).
More models are added with a JSON list in `EXTYNT_DECISION_MODELS`. Each entry names a `dialect`; an entry that is
malformed, or whose key is missing, is skipped with a readable reason (`decisionModelSetup(...).skipped`) and the rest stay.

```json
[
  { "dialect": "systemone", "id": "local", "baseUrl": "http://127.0.0.1:11435", "model": "decider", "keyEnv": "LOCAL_KEY" },
  { "dialect": "openai", "id": "openai", "model": "gpt-4o-mini" },
  { "dialect": "openai", "id": "gateway", "model": "some-model", "baseUrl": "https://llm.example.com/v1", "keyEnv": "GATEWAY_KEY", "calibrated": true, "threshold": 0.7 },
  { "dialect": "cloudflare", "id": "workers", "accountId": "<account id>", "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  { "dialect": "cloudflare", "id": "workers-gw", "accountId": "<account id>", "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "gateway": "<gateway id>", "keyEnv": "CF_TOKEN" }
]
```

| Dialect | Required | Optional | Key variable |
| --- | --- | --- | --- |
| `systemone` | `id`, `baseUrl`, `model` | `keyEnv`, `threshold`, `calibrated` | `keyEnv`, none by default |
| `openai` | `id`, `model` | `baseUrl` (default `https://api.openai.com/v1`), `keyEnv`, `threshold`, `calibrated` | `OPENAI_API_KEY` |
| `cloudflare` | `id`, `accountId`, `model` | `keyEnv`, `gateway` | `CLOUDFLARE_API_TOKEN` |

`keyEnv` names the variable that holds the key. An `openai` or `cloudflare` entry without a key is skipped, except an
`openai` entry on a loopback address, which needs none. A remote `baseUrl` must be `https`; plain `http` is accepted only for
`localhost`, `127.0.0.1`, `[::1]` and `*.localhost`. Entries come after Jev, in order, and all of them are in the decision-model
tier, so any of them wins over the chat-model fallback.

**Bands.** Confidence thresholds belong to a provider, not to the package. An entry with `calibrated` false or unset (the
default) routes with the conservative `LANGUAGE_MODEL_BANDS` (verify 0.8, act 0.9) and ignores `threshold`; the `cloudflare`
dialect is always uncalibrated. With `calibrated: true` and a `threshold`, both bands are that threshold, tightened or loosened
as you fitted it; with `calibrated: true` and no threshold, each decision's own fitted bands apply (the ones fitted to Jev).
`calibrated` on each result tells you whether the confidence is a real probability.

**The `openai` dialect** posts the batched questions to `{baseUrl}/chat/completions` with
`response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}`, the schema built from the questions by
`replySchema`, and reads `choices[0].message.content`. It reuses `languageDecisionModel`, so question and answer handling is
the same as for the chat-model tier. It needs a server that supports strict structured outputs.

**The `cloudflare` dialect** posts to the native endpoint `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/{model}`
with `messages` and `response_format: {type: "json_schema", json_schema: <schema>}`, and reads the `result.response` field (an
object, or a JSON string). With `gateway` it posts to `https://gateway.ai.cloudflare.com/v1/{accountId}/{gateway}/workers-ai/{model}`.
Both send `Authorization: Bearer <token>`; a gateway that requires its own authentication token is not supported.

Why the native endpoint and not Cloudflare's OpenAI-compatible one: the JSON-mode page
(https://developers.cloudflare.com/workers-ai/features/json-mode/) documents `response_format` with `json_schema` on the native
request and shows the result in a `response` field. The OpenAI-compatibility page
(https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) lists `/chat/completions` but says nothing about
`response_format` or `json_schema`, so building on it would rest on an undocumented behaviour. JSON mode is also best-effort
(a request can fail with "JSON Mode couldn't be met", which is reported as `rejected`), and the supported models are those on the
JSON-mode page. The gateway address follows Cloudflare's AI Gateway provider form
(https://developers.cloudflare.com/ai-gateway/); the pages above did not show it, so check it against your gateway.
No live Cloudflare or OpenAI call is part of the test suite; every test uses an injected fetch.

## Local decision servers

Some open-weight servers speak the System One wire (`POST /v1/systemone`: the state and typed questions in, one answer each
out) and run on your own machine, usually without a key. Point a `systemone` entry at one:

```json
[{ "dialect": "systemone", "id": "local", "baseUrl": "http://127.0.0.1:11435", "model": "<model>" }]
```

A local server that takes a bearer key can name `keyEnv`. A local server that only offers an OpenAI-compatible chat endpoint
with `json_schema` response format works through the `openai` dialect, with no key on a loopback address:

```json
[{ "dialect": "openai", "id": "local-chat", "baseUrl": "http://127.0.0.1:11434/v1", "model": "<model>" }]
```

These entries run uncalibrated, with the conservative bands (verify 0.8, act 0.9), until you set `"calibrated": true` and a
`threshold` fitted on your own data. If the server is not running the connection is refused, the decision falls back to the
next tier (ultimately the deterministic answer) with the reason "unavailable: nothing answered at the configured address", and
nothing is retried within the call.

## Privacy

A decision's state is sent to a decision model only when you configure one: with no `TYPESAFE_API_KEY` and no
`EXTYNT_DECISION_MODELS` entry, no request is ever made. When you do configure one, the state of every decision resolved
through it, which includes the request text and the question data, is sent to that provider (Jev, an `openai` endpoint or Cloudflare
Workers AI and its optional AI Gateway); use a local server if the state must stay on your machine.
In the sidecar the chat model also answers the opted-in decisions when no decision model is configured. That sends the
same request text the chat model already receives to the same provider; set `EXTYNT_CHAT_MODEL_DECISIONS=0` to turn it off.

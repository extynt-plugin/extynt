# ADR 0045: small closed questions go through typed decision ports

Status: accepted

## Context

Around the agent's main loop there are many small fuzzy choices: which effect does this phrase name, is this a drawn
scene, does the request need a picture-based review, is the job finished, which font family is meant. Left to the main
language model, each one costs a turn or a prompt paragraph, answers differently from run to run, and is hard to test.
Left to regular expressions, each one is brittle outside English and outside the words the author thought of.

Each of these choices can be framed as a closed question: pick one of a few labels, pick every label that applies, place
the state on a short rubric, or answer yes or no. A closed question has a small, checkable answer space, so it can be
asked of a cheap model in a batch, scored against labelled examples, and always has a safe answer when no model is
available.

## Decision

Every such choice is declared once, as a typed spec in `packages/decide`, and answered by the best tier available.

1. **Four kinds of spec.** `choice` (one of 1 to 255 labels), `labels` (any number of labels apply), `score` (2 to 10
   ordered levels) and `binary`. The result type is inferred from the spec, and every result records which tier
   answered, which provider, whether the confidence is calibrated, and why a higher tier fell back, if one did.
2. **Three tiers, in order.**
   - A **decision model**: a server built to answer decision questions. The sidecar sends every decision it can to the
     first configured one as a single batch. Four kinds of server are supported: Jev from TypeSafe AI (set
     `TYPESAFE_API_KEY`), any server that speaks the System One wire (`POST /v1/systemone`, often a local server with
     no key), any OpenAI-compatible chat endpoint that supports strict JSON-schema output, and Cloudflare Workers AI,
     optionally through AI Gateway. Further models are listed in `EXTYNT_DECISION_MODELS`, each naming a `dialect`.
     A configured decision model is used automatically; there is no per-call switch. A call that fails, times out
     (4 seconds by default), is refused, or is not confident enough hands that decision to the next tier.
   - The **user's own language model**, behind a narrow `LanguageModelPort`. It costs a turn, so a spec opts in with
     `useModel: true`; today only `drawn-scene` and `request-scale` do. The reply is constrained by a JSON schema built
     from the questions. The sidecar adds the chat model as this tier only when no decision model is configured, the
     chat provider supports structured output, and `EXTYNT_CHAT_MODEL_DECISIONS` is not `0` (`decision-language.ts`).
   - The **deterministic function** in the spec. It is pure, offline, and always the final answer.
3. **Confidence bands.** Each model answer is routed by its confidence against two numbers. At or above `act` the
   answer is taken. Between `verify` and `act` it is taken only if it agrees with the deterministic answer or leads
   it by a clear margin (0.15 in probability, or a stronger user habit). Below `verify` it is dropped. A spec with
   `stakes: "high"` never overrules the deterministic answer in the verify band.
4. **Bands are fitted per decision.** `fitted-bands.ts` holds one pair of bands per decision, fitted from the labelled
   evaluation in `tools/chat-tests`, so a hard decision gets a higher bar than an easy one. The fit is provisional:
   it was made on the same cases it was scored on. Thresholds belong to a provider, not to the package. A decision
   model that is not marked calibrated ignores the fitted bands and routes with conservative ones (verify 0.8, act
   0.9). The user's own language model always uses those conservative bands. Only a model configured with
   `"calibrated": true` uses fitted bands, or a single threshold the user fitted on their own data.
5. **Guarded labels.** A choice can name labels that are costly to get wrong. The main one is `answer-only` in
   `request-route`: answering a real edit request with text alone would silently do nothing. A model answer of a
   guarded label is taken only in the act band, never by winning a disagreement.
6. **A tournament for long lists.** A question holds at most 255 labels, and a model keeps its accuracy only far below
   that. For lists that grow with the user's machine (installed effects, controls, fonts) `tournamentChoice` splits
   the candidates into groups of at most 40, asks one question per group (at most 24 questions per request, the
   requests of a round in parallel), then asks a final question over the group winners plus the best word-search
   hits, recursing if that is still too long. With no model the answer is the word search's.
7. **Wired decisions.** The sidecar consults them at these points:
   - Job open (`decision-job-specs.ts`), one batch over the request: `request-parts`, `drawn-scene`, `request-scale`,
     `evidence-temporal`, `evidence-visual`, `evidence-judgement`, `visual-waiver`, `layer-style-request`,
     `request-route`, `request-specialists`, `model-tier`,
     and one `named-object` question per name the request carries.
   - Build-kit resolution (`decision-resolve.ts`): `effect`, `control` and `font` (tournaments) and `property`.
   - During the job: `request-missing` (which asked features are still absent), `continuation` (is a message to a stopped job a resume), `question-answered` and `ended-in-prose`
     (how a turn ended), `review-proven` (do the receipts already prove the covered work, so the picture review can
     be skipped; high stakes, no deterministic yes) and `frame-quality` (advisory only; it adds a note and never
     refuses a completion).
   - Two routing seams read the booked job-open answers. A message goes to the answer-only path only when
     `request-route` says `answer-only` in the act band, and never when a job, a carried question, a picture or a
     reply to the assistant's question is pending. When the user configured two different tool-calling models, a
     request that `model-tier` settles as `fast` in the act band runs on the lighter one first.
8. **Privacy.** With no decision model and no chat-model tier, no decision request is ever made. When a decision
   model is configured, the state of every decision sent to it, which includes the request text and the question data,
   leaves the machine for that provider; a local System One or loopback OpenAI-compatible server keeps it on the
   machine. The chat-model tier sends the same request text the chat model already receives to the same provider; set
   `EXTYNT_CHAT_MODEL_DECISIONS=0` to turn it off. A remote `baseUrl` must be `https`, and a keyless entry is accepted
   only on a loopback address. The local decision log (`decision-log.jsonl`, owner-only, one rotated generation)
   records the tier, answer, confidence, band, fallback reason and latency of each decision, never the request text
   and never a key.

## Consequences

**Measured.** The evaluation harness in `tools/chat-tests` (`decision-eval.ts`) puts labelled fixtures to whatever
decision models the environment configures; with none configured it runs the deterministic tier alone, and `--stress`
adds the dropped-candidate suites. The offline run of 2026-10-25 scores 24 spec suites with 625 labelled cases (622
correct), 4 dropped-candidate stress suites with 121 cases (103 correct), and 7 tournament suites with 309 cases (294
correct by the word search). These are development numbers: the fitted bands were fitted on the same fit set, so they
are not an accuracy estimate. The held-out blind set, which is kept outside the repository, scores 399/424 under the
shipped bands with every suite at or above 80%: font-description blind fit 11/12 and heldout 9/10; the closest are
request-specialists fit at 82.4% and request-route fit at 81.3%. Font-description accepted sets are judged broadly: a
family counts unless most designers would reject it. The deterministic tier is covered by unit tests with injected
`fetch`, on every platform, with no network. The numbers depend on the model and the day, and the fitted bands are
provisional.
Per-suite deterministic numbers from the 2026-10-25 offline run: [0046-measurements.md](0046-measurements.md).

**Not measured.** The user's own language model tier has no fitted bands; its conservative bands are a prior, not a
result. The OpenAI-compatible and Cloudflare dialects have only been exercised against injected responses in the test
suite, never a live service. Cloudflare's JSON mode is documented as best-effort.

**Trade-offs.**
- One more kind of configuration, and one more place data can leave the machine. The default is off, with one
  exception: the chat-model tier turns on by itself, and has an environment switch to turn it off.
- Latency is bounded (4 seconds for a decision model, 30 for the user's model) and failure is cheap, because
  the deterministic answer is always there; but a slow decision model can still add its timeout to a job start.
- A decision's behaviour now depends on three tiers, so a result must be read with its `source` and `fallback`.
  The decision log exists for that.
- Uncalibrated models are held to a higher bar, so they overrule the deterministic answer less often than a calibrated
  one would. That is deliberate: a missed improvement is cheaper than a wrong action.
- Decisions that guard an irreversible or silent outcome (answer-only, review skipping) can only be won by a
  confident model. The cost is that a hesitant model never speeds those paths up.

## Alternatives

- **Keep everything in the main language model's loop.** Simplest, but each choice costs a turn and context, is
  unevenly reliable, cannot be scored in isolation, and has no offline answer. Rejected.
- **A fine-tuned local classifier only.** Cheap and private, but it would ship weights to maintain, cover only the
  labels it was trained on, and fit awkwardly with lists that differ on every machine (effects, fonts). A local
  classifier that speaks the System One wire or an OpenAI-compatible endpoint plugs into the same port, so this stays
  possible without making it the only path.

# ADR 0046 measurements: decision tiers, deterministic dev run

Measured on 2026-10-25 with
`node tools/chat-tests/dist/src/decision-eval.js --stress`, with no decision model configured (`TYPESAFE_API_KEY`
unset), so every answer comes from the deterministic tier. The fitted bands are irrelevant to this run.

These are development numbers. The fixtures are the fit set: the spec and tournament answers were tuned against them,
so they are not an accuracy estimate for unseen requests. The held-out blind set, kept outside the repository, is
reported in [0045-decision-models.md](0045-decision-models.md).

Columns: **correct** is the deterministic answer that matched the expected label (or the expected "none" for a stress
case); the language columns give the same count per language. A dash means the suite has no cases in that language.

## Spec suites (fit)

| suite | cases | correct | en | es | de | ja |
|---|---:|---:|---:|---:|---:|---:|
| effect-pick | 42 | 42 (100%) | 35/35 | 2/2 | 2/2 | 3/3 |
| effect-habits | 12 | 12 (100%) | 12/12 | - | - | - |
| control-resolution | 29 | 29 (100%) | 22/22 | 2/2 | 3/3 | 2/2 |
| font-matching | 37 | 37 (100%) | 30/30 | 2/2 | 2/2 | 3/3 |
| request-parts | 33 | 33 (100%) | 27/27 | 2/2 | 2/2 | 2/2 |
| request-completion | 34 | 34 (100%) | 28/28 | 2/2 | 2/2 | 2/2 |
| drawn-scene | 20 | 20 (100%) | 15/15 | 2/2 | 1/1 | 2/2 |
| named-object | 16 | 16 (100%) | 12/12 | 2/2 | 1/1 | 1/1 |
| layer-style | 15 | 15 (100%) | 11/11 | 2/2 | 1/1 | 1/1 |
| evidence-temporal | 32 | 32 (100%) | 24/24 | 3/3 | 2/2 | 3/3 |
| evidence-visual | 32 | 32 (100%) | 24/24 | 3/3 | 2/2 | 3/3 |
| evidence-judgement | 32 | 32 (100%) | 24/24 | 3/3 | 2/2 | 3/3 |
| request-scale | 20 | 20 (100%) | 14/14 | 2/2 | 2/2 | 2/2 |
| continuation | 19 | 19 (100%) | 12/12 | 2/2 | 2/2 | 3/3 |
| ended-in-prose | 14 | 14 (100%) | 14/14 | - | - | - |
| question-answered | 14 | 14 (100%) | 14/14 | - | - | - |
| visual-waiver | 16 | 16 (100%) | 13/13 | 1/1 | 1/1 | 1/1 |
| frame-quality | 17 | 17 (100%) | 14/14 | 1/1 | 1/1 | 1/1 |
| modal-risk | 20 | 20 (100%) | 20/20 | - | - | - |
| property-choice | 38 | 38 (100%) | 34/34 | 2/2 | 1/1 | 1/1 |
| request-route | 45 | 45 (100%) | 36/36 | 3/3 | 3/3 | 3/3 |
| request-specialists | 36 | 34 (94%) | 28/30 | 2/2 | 2/2 | 2/2 |
| model-tier | 31 | 31 (100%) | 25/25 | 2/2 | 2/2 | 2/2 |
| review-proven | 21 | 20 (95%) | 20/21 | - | - | - |

All 24 spec suites total 625 cases and 622 correct (99.5%). The lowest suites are request-specialists (94%) and
review-proven (95%); the misses are 2 of 36 and 1 of 21.

## Stress suites (dropped candidate)

Each stress suite removes the wanted candidate from the list, so the right answer is "none". These are not part of the
fit total above.

| suite | cases | correct |
|---|---:|---:|
| effect-pick-dropped | 35 | 30 (86%) |
| control-resolution-dropped | 26 | 25 (96%) |
| font-matching-dropped | 31 | 22 (71%) |
| property-choice-dropped | 29 | 26 (90%) |

The four stress suites total 121 cases and 103 correct (85%). font-matching-dropped at 71% is the weakest number in
this file. Reported as measured.

## Tournament suites (fit)

The tournament answer is the word search. The Jev tournament column of the earlier run is not measured here.

| suite | catalogue | cases | word search correct |
|---|---:|---:|---:|
| effect-resolution | 196 | 42 | 37 (88%) |
| effect-scale-300 | 300 | 42 | 37 (88%) |
| effect-scale-2000 | 2000 | 42 | 37 (88%) |
| font-resolution | 59 | 37 | 37 (100%) |
| font-scale-300 | 300 | 37 | 37 (100%) |
| font-scale-2000 | 2000 | 37 | 37 (100%) |
| font-description | 104 | 72 | 72 (100%) |

The seven tournament suites total 309 cases and 294 correct (95%). font-description is judged broadly: an accepted
family counts unless most designers would reject it.

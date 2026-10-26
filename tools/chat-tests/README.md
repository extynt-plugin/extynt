# chat-tests

Drives the in-panel agent through realistic composition requests and reports what
it actually did — which layer a plan targeted, which property paths it asked for,
what it said, and what it cost.

It exists because the panel's plan card cannot answer those questions. The card
shows an operation type and a layer name (`animate_property · TITLE — Summer`);
the keyframe values, the property path and the target id live in the plan store
and the sidecar log, where nobody reads them by hand.

```bash
pnpm --filter @extynt/chat-tests build
node tools/chat-tests/dist/src/cli.js list
node tools/chat-tests/dist/src/cli.js run            # offline, no network, no cost
node tools/chat-tests/dist/src/cli.js run --live     # the model configured in the repo .env
node tools/chat-tests/dist/src/cli.js run --live --scenario title-slide-and-fade
node tools/chat-tests/dist/src/cli.js run --live --model deepseek-v4-pro
node tools/chat-tests/dist/src/cli.js run --live --fake-host   # apply what the turn seals, on the fixture
node tools/chat-tests/dist/src/cli.js run --live --fake-host \
  --scenario staged-brand-opener # verified against the fixture's read-back; never real AE evidence

node tools/chat-tests/dist/src/cli.js trace --scenario title-ident-from-scratch --live
node tools/chat-tests/dist/src/cli.js trace --live --out /tmp/transcript.txt
node tools/chat-tests/dist/src/cli.js run --live --ledger benchmark-results/baseline.benchmark.jsonl
node tools/chat-tests/dist/src/cli.js ledger benchmark-results/baseline.benchmark.jsonl
node tools/chat-tests/dist/src/cli.js corpus /path/to/project/manifest.json
```

`run` answers **did it do the right thing** and prints a report. `trace` answers
**why did it do that** and prints the whole turn: the briefing the model worked
from, the tools it was offered, every message it was sent, the model's own
reasoning, every tool result in full, per-step duration and tokens, and how the
turn ended.

`--ledger` appends one schema-versioned row per scenario. Rows contain bounded counts,
codes, target verdicts, receipt state, timings, and usage; they deliberately exclude
prompts, project text, operation values, and transcripts. Generated ledgers belong in
`benchmark-results/` (ignored by Git). Use `ledger <file>` for a read-only summary.

A row (schema `0.2`) also records, per scenario and per turn: pass/fail, model calls (total and per role),
fresh input, cached input and output tokens (total and per role), and wall time. Per-role data is read from the
sidecar's turn result when it reports a breakdown (`main`, `visual-scene`, `motion`, ...); without one the row holds
`main` only, with the call count taken from the step count (`modelCalls.basis` says which). Schema `0.1` ledgers still read.

Real `.aep` projects use the intake contract under `fixtures/projects/`. Source projects,
media, and fonts stay outside the repository by default; only reviewed manifests and
sanitized initial/expected structures should be considered for commit.

## Choosing a model

`--model` overrides `AE_LLM_MODEL` for the child sidecar, so the same scenarios
can be run against different models and compared. Without it the suite tests
whatever `.env` configures, which is the service default.

Model names are not all distinct. Asked directly, the API echoes back the
canonical id it served:

| Requested | Echoed back |
|---|---|
| `deepseek-flash` | `deepseek-flash` |
| `deepseek-v4-flash` | `deepseek-flash` |
| `deepseek-chat` | `deepseek-flash` |
| `deepseek-v4-pro` | `deepseek-v4-pro` |

So a run labelled `deepseek-v4-flash` is a run of the same model as
`deepseek-flash` — worth knowing before attributing a difference to "the v4
flash model". `deepseek-v4-pro` is genuinely a different model.

## What each mode proves

| Mode | Provider | Proves |
|---|---|---|
| `run` | the sidecar's built-in mock | the fixture publishes, the agent loop calls tools, a plan comes back bound to the right layer |
| `run --live` | whatever `.env` configures | how a model actually behaves. Costs money, so the transcript prints token usage |
| `run --fake-host` | either | the batches the turn seals are **applied**: the sidecar's native lane sends them to the fake plugin (`src/fake-plugin-host.ts`, on `tools/fake-plugin`), which applies them to the fixture project with `src/fake-host.ts`. The sidecar reads the project back from the plugin and verifies the receipt itself, so the turn's next inspection reads its own work and receipt-gated multi-stage evaluation works. This is headless evidence only, never a real After Effects claim |
| `trace` | in-process, recording | everything the two above cannot show: the prompt, the reasoning, the tool results |

Every run serves the fixture project through the fake plugin, which is what the sidecar's
single native lane talks to. Without `--fake-host` the sidecar is told to ask before applying,
so a turn can only be watched *authoring*: nothing is applied, `ae_status` reports nothing
applied, no undo count exists, and the model never sees the result of its own work, which is
half of the loop the briefing tells it to rely on. The applier is a model of After Effects, not
an emulator: 27 of the 55 typed operations are implemented, the rest are refused by name, and a
refusal travels back in the receipt exactly as a host refusal would. `fixtureOperationCoverage()`
prints the split.

`--fixture-readback` is still accepted and means nothing extra: `--fake-host` always verifies
against the fixture's read-back. That does not establish real After Effects support, undo
grouping, read-back fields, visual quality, or temporal behavior.

Only `trace` starts the sidecar in-process. A spawned child is the shipped path
and the right default for pass/fail runs, but nothing outside it can see the
provider — and a transcript is mostly the provider's own view of the turn.

## Saved traces

Every `run` and `trace` saves one JSONL trace per scenario to
`tools/chat-tests/traces/<run id>/<scenario>.jsonl`, which git ignores, so each run
leaves data behind: timings, tool calls and answers. `--no-trace` skips saving and
`--trace-dir <dir>` saves elsewhere. A `trace` file holds the full provider traffic. A
`run` file is built from the spawned sidecar's own log lines, because a spawned
child cannot hand over its provider traffic.

## Adding a prompt

Drop a markdown file into `prompts/`. No code change and no rebuild: the library
is read from disk at run time, and `list` shows what loaded and from where.

```markdown
---
id: my-new-prompt          # optional; defaults to a slug of the file name
asset: empty-ident         # required; see the Assets table
offline: false             # optional; true only if the mock provider can answer it
notes: what this is probing for
expect: {"plans":{"min":1}}  # optional; one line of JSON
---
The request, verbatim. Line breaks and indentation are preserved, so write it
the way you would type it.
```

A prompt earns a **file** when it tests what the *model* does with a real
request. A scenario earns a **code definition** in `src/scenarios.ts` when it
tests what the *harness* does — the offline mock, the skip behaviour, that a
question does not become a plan. Both end up in one list.

Keep `expect` loose on a prompt you are still exploring. An expectation that
pins wording will fail for the wrong reason; one that pins nothing means a run
cannot tell you it went wrong, so pin the structure you actually care about.

### Several turns and project facts

A prompt can hold a whole conversation: put `--- next turn ---` on a line of its own between user messages. Each later
turn is sent with the earlier turns as history, the way the panel carries a conversation. An optional front-matter
`facts` line (one line of JSON, one list per turn) pins what the project must look like after each turn, checked on the
fake host's snapshot (`src/project-facts.ts`): `comp-with-solid:<name>`, `no-composition:<name>`, `compositions-unchanged`,
`parent-is-null:<layerId>`, `parent-null-expression:<layerId>:<text>`. Facts need `--fake-host`; elsewhere they are skipped
with a note, never counted as passed.

## Running against a real plugin

```bash
node tools/chat-tests/dist/src/cli.js run --live --plugin-endpoint /path/to/native.json --scenario null-parent-wiggle
```

`--plugin-endpoint` points the spawned sidecar at an already-running extynt plugin (for example After Effects reached
over a forwarded port) instead of the fake plugin. `native.json` holds the port and token; a copy without its pid is
installed in the child's isolated state directory, because the pid belongs to another machine and would read as stale.
No fake plugin starts and no fixture is published: the open project is used as is, so open the right comp first and
reset it between scenarios. What a turn seals is applied. Project facts are skipped on this path (the ledger row's
evidence mode is `live-host-structural`, with no per-operation receipt counts). It cannot be combined with `--fake-host` or `trace`.

## Why the transcript cannot live in the sidecar

The shipped sidecar's diagnostics channel is deliberately narrow (ADR 0013): event
names, ids, counts and timings, never request bodies, response bodies, project
data or expressions, because the installed binary must not become a copy of the
user's project. A conversation transcript is all of those things. So it lives
here, and `scripts/build-mac-bundle.sh` deletes `tools/` from the bundle —
the recording provably cannot ship.

It also needs no cooperation from the product: `runAgent` takes its provider by
injection, so a provider that records each `step()` and then delegates sees every
message the loop sent and the provider's entire raw reply. Nothing in
`apps/sidecar` had to change.

Live scenarios are **skipped, not dropped**, when no model is configured — a run
that quietly tested nothing would be worse than one that says so.

## Assets

`src/assets.ts` holds probe snapshots — the same envelope the panel POSTs to
`/v1/snapshots` — so an asset can be published to a sidecar unchanged. They are
authored rather than captured, so the tests are reproducible in CI; the property
paths and matchNames are the real After Effects vocabulary this repository
already relies on (`tools/host-verification/src/cases/helpers.ts`), not invented
strings.

| Asset | Composition |
|---|---|
| `summer-launch` | 1920×1080 title spot: text title (selected), lower third, shape accent, blurred plate, null control |
| `social-square` | 1080×1080 cutdown with background, headline, supporting copy, and a selected badge |

## Scenarios

A scenario is a request plus the structural facts that must hold whatever the
model says: the outcome, how many plans, which layer is targeted, which property
paths appear. Expectations never pin the model's wording — wording changes
between models and runs, and a test that pinned it would fail for the wrong
reason.

## Isolation

The sidecar writes a per-user pairing file on boot, so the runner gives the child
process its own `HOME`. Nothing here can touch your real `~/.config/extynt`
(or `~/Library/Application Support/extynt`). Live runs read the provider key from
the repo `.env` and pass it to the child; it is never logged, and a transcript
records the provider and model instead.

## Limitations worth knowing

- A live turn over a long art-direction prompt costs 160–240s and 400–600k input
  tokens. The live timeout default is ten minutes, and a turn that ends without an
  answer is reported as `CUT OFF` — by the harness ceiling or by a provider that
  stopped replying — with no expectation checked against it: it is a fact about the
  infrastructure, not a verdict on the agent. A four-minute ceiling used to throw
  away the slowest and most informative runs, and reading
  `0 plan(s), expected at least 1` as a model failure made a censored matrix look
  like a result.
- A single model call is not the same budget as a whole completion: it may be the
  reply that writes a whole plan as a tool call. `packages/llm` floors one agent
  step at `AGENT_STEP_TIMEOUT_FLOOR_MS` (five minutes) for that reason; a 90-second
  floor, left over from when the briefing capped a plan at 25 operations, killed a
  watched run on the step that would have written the plan.
- `--watch` narrates a turn as it runs, polling the same progress endpoint the panel
  polls: each step, and each one-line note the model writes about what it is doing.
- Every run reads the sidecar's plan store back through `ae_list_plans` and
  compares it with the turn's own plan list. The list is a projection of the
  store, and a projection can be wrong: a plan repaired with `ae_amend_plan`
  reached the store while the turn reported no plan at all, so the run was scored
  as a model failure. A disagreement now fails the run and says which side is
  which.
- The sidecar truncates logged `ae_propose_plan` arguments at 400 characters, so a
  very large plan can hide its later operations from the haystack the expectations
  search. Expectations name layers and common property paths for that reason.
- Offline mode exercises the harness with a scripted model, not model quality.
  Only a `rename …` request is understood by the mock provider; anything else is
  marked live on purpose.

# ADR 0030: host policy boundary and fake-host evidence

Status: accepted

## Context

The facts used to decide whether a typed operation may run are kept apart from
the evidence available after it runs. The plugin is the only component that
crosses into After Effects, but it is not the workflow authority. The sidecar
owns admission, approval, dependency state, receipt correlation, and
continuation. It sends the plugin one sealed, typed command over the host lane
and receives what the host hop and its read-back actually established.

The headless fake host (`tools/chat-tests`) and fake plugin (`tools/fake-plugin`)
are the repeatable architecture test loop. They are intentionally not an After
Effects emulator: the fixture implements a named subset of operations and
refuses the rest, while the fake plugin simulates the production
reserve/approval/apply/receipt/snapshot ordering. A green fixture run therefore
proves only the sidecar and plugin contracts that the fixture models.

## Decision

### Policy dimensions remain separate

Admission and presentation keep these dimensions distinct:

| Dimension | Question | Example outcome |
| --- | --- | --- |
| Schema and values | Is the typed operation well-formed? | valid / invalid |
| Target and dependency | Does it name a current, resolved target? | resolved / stale / missing |
| Host support | Does this host contract support it? | supported / refused / unknown |
| Verification | What can a fresh observation establish? | exact / partial / unavailable |
| Mutation risk | What could have changed? | none / applied / may-have-mutated |
| Recovery | Can the result be safely undone or reconciled? | undoable / guarded / blocked |

No single `success` flag may erase these distinctions. The host lane may report an
executed apply with `applied_unverified` when it has no trustworthy read-back;
it reports `uncertain` or `partial_mutation_possible` when the host response
does not establish whether a mutation happened. A refusal before the first
host write remains retryable only when the receipt proves `not_run` and
`mayHaveMutated:false`. Unknown, failed-after-dispatch, or partially applied
work is never silently retried.

### The host boundary is typed and one-way

The sidecar seals the batch and remains the sole workflow authority. Approval
is bound to that batch digest and execution snapshot. The host lane performs
the preflight freshness check under the dispatch lease, invokes the
compiler-produced typed host command, collects the host result, performs the
permitted fresh probe, and settles one correlated receipt. The plugin cannot
create a new workflow batch, reinterpret a receipt as permission to continue,
or turn arbitrary model text into host code.

The command path has no raw JSX or arbitrary generated host-code escape hatch.
The plugin runs only allowlisted host-library entries with escaped arguments. A
receipt does not widen the operation vocabulary after admission.

### Fake-host evidence is explicitly scoped

The fake host copies the input snapshot, applies only operations it models, and
returns one verdict per operation. An unmodelled operation is refused by name
with `UNSUPPORTED_IN_FIXTURE`; it is not approximated, silently dropped, or
reported as applied. Refused operations do not mutate the fixture or advance
its revision. This lets tests prove deterministic dependency and receipt
semantics without pretending to reproduce AE internals.

The fake plugin preserves the production ordering: sealed batch, lease,
approval, host dispatch, receipt, and fresh snapshot. Its default receipt mode
is `applied_unverified`. The explicit `verified` test mode means only that the
fixture's fresh snapshot matched the fixture's deterministic postcondition;
its receipt basis is `headless fixture readback`. It is not evidence that a
real After Effects build supports the operation, creates one undo group, or
returns the same read-back fields.

### Rollout gates

An operation family may be promoted for a selected AE build only after all of
the following are recorded independently of fake-host green runs:

1. a real-host script confirms the actual host command and undo-group
   boundary for one admitted batch;
2. a fresh real-host probe confirms every structural field used for exact
   verification and any cross-batch created-ID binding;
3. host refusal, callback timeout, and callback loss immediately before and
   after mutation are observed and classified without automatic replay;
4. the operation's verification and recovery policy is assigned (automatic,
   manual-only, probationary, or blocked) for the supported host/version; and
5. the panel presentation exposes applied, applied-unverified, failed, uncertain,
   and blocked outcomes distinctly, including what the user can do next.

Promotion is evidence-led and host-version-specific. A fixture result cannot
promote a real host capability, prove AE visual/temporal behavior, or replace
the focused real-AE validation script.

## Consequences

- The plugin remains a narrow, auditable mutator and receipt producer.
- Sidecar policy can combine host support, verification quality, risk, and
  recovery without flattening them into schema validity.
- Fake-host tests provide fast adversarial coverage for the architecture loop,
  while their evidence is visibly prevented from being mistaken for AE proof.
- Rollout can enable a typed operation family only after real-host undo,
  read-back, and callback-loss evidence is captured for the target build.


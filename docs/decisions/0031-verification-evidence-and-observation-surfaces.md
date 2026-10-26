# ADR 0031: verification evidence and observation surfaces

Status: accepted

## Context

The verification vocabulary is an auditable boundary. An apply receipt answers whether a typed host command ran
and what structural postcondition was established. Host-enforced evidence can
answer a narrower operation-specific question when the host itself read the
value back or confirmed an output. Visual and temporal observations answer
different questions and must not be folded into structural apply success.

The sidecar host lane, MCP server, and host-verification tooling are separate
producers: the host lane owns the fresh probe and bounded local frame capture,
the MCP server normalizes receipts and exposes observation tools, and the
verification kit records host/version-specific evidence. Fake-host runs exercise
the protocol but cannot promote any of those claims to real After Effects
support.

## Decision

### Evidence is a ladder, not one boolean

Every operation and job outcome keeps these claims distinct:

| Evidence class | Establishes | Does not establish |
| --- | --- | --- |
| Structural | A fresh snapshot matches deterministic postconditions | Visual quality or rendered motion |
| Host-enforced | The host checked a named value/output under an exact operation/token rule | A general capability outside that rule |
| Visual | Bounded frame measurements or a user/model-visible frame at one time | Structure, causality, or motion between times |
| Temporal | Bounded observations at multiple times support a requested change or direction | Perceptual quality or every intermediate frame |
| Unavailable | The requested evidence could not be collected | Success or failure of the underlying mutation |

`confirmed`, `host_confirmed`, and `coerced_equivalent` are the only
per-operation outcomes that may count as verified structural/host evidence.
Weak host labels remain `applied_unconfirmed`; a missing read-back is not a
mismatch. A positive mismatch remains a mismatch even when a receipt also
contains a host label. `applied_unverified`, `unknown`, and
`mayHaveMutated` are never automatic continuation grants.

### Apply receipts and observations are separate surfaces

The host lane settles one bounded apply receipt after the typed host hop and
fresh read-back. The receipt's postcondition is structural/host evidence only. The
MCP observation tools are read-only and separate:

- `ae_capture_composition_frame` requests one bounded, local PNG at an exact
  composition time; it never edits the project or uploads the frame to a
  provider;
- `ae_get_capture_frame` retrieves a pending capture without inventing a
  measurement; and
- `ae_observe_frame` returns numeric content fraction, bounding box, 3x3 region
  coverage, transparency, and dominant-colour measurements when the host lane
  produced them.

The host lane may publish a successful frame without `sampledPixels` when decoding
or measuring the image was unavailable. That result is still a capture, but it
is not visual evidence. A partial PNG, failed native read, missing capture, or
pending capture is reported as unavailable/pending with a bounded next action;
it is never summarized as a visual pass or as a structural apply failure.

To support a temporal claim, callers capture and compare at least two bounded
times and retain the time/capture identities. One frame cannot prove motion,
direction, or temporal continuity. A visual or temporal observation may satisfy
an explicitly declared criterion only through its typed observation reference;
it does not rewrite the apply receipt or authorize a new mutation.

### Host evidence is version-scoped and promotion-gated

The host-evidence rule table is exact and operation-specific. A token is strong
only when the named host code emitted it after enforcing the corresponding
read-back/output check. Labels emitted by a different operation, request echo
fields, weak setter-return labels, fixture readback, or catalogue knowledge do
not promote a capability. The verification kit records the host application,
version/build, platform, case, baseline/after/undo readbacks, and receipt
outcome; promotion is keyed to that host evidence rather than to a global
operation name.

Real-host rollout requires focused evidence for structural read-back, actual
undo grouping, visual/temporal observation limits, and callback loss around
mutation. Fake-host green tests remain necessary protocol evidence but are
never host certification. Restart also remains narrow: no observation or
receipt may recreate a host command, approval capability, provider wake,
or mutation attempt automatically.

## Consequences

- Users and models can distinguish applied, structurally verified,
  host-confirmed, visually observed, temporally observed, unavailable, and
  uncertain outcomes.
- Numeric frame observations remain useful to models that cannot inspect an
  image, while the absence of a measurement stays explicit.
- Host capability promotion is auditable and version-specific; fixture and
  catalogue evidence cannot silently widen automatic policy.
- Completion and continuation must reference the evidence class required by
  the criterion, and no observation surface becomes a retry or restart path.


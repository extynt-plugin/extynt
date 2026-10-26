# ADR 0034: truthful workflow presentation and controls

Status: accepted

## Context

The panel is the user's explanation surface, not a second workflow engine. A
single green or red label hides important differences between an admitted
batch, a host command that ran, a verified postcondition, an applied-but-
unverified result, a possibly mutated timeout, an undo mismatch, and a durable
job blocker.

Plan cards show approval, receipt, verification and guarded undo. The workflow
needs a small read-only status presentation alongside them, with language that
stays accurate after restart and during a held host lease.

## Decision

The diagnostics drawer includes a Workflow section fed only by the sidecar's
read-only status projection. It keeps these dimensions separate:

| Display | Meaning |
| --- | --- |
| Recovery | Whether durable inspection exists and whether fresh explicit authorization is needed |
| Job/batch | Sidecar lifecycle and current bounded execution unit |
| Evidence | Execution, verification and mutation facts, without a synthetic success flag |
| Blocker | Provider failure, divergence, uncertain work, or no blocker |
| Host lease | Whether a claimed or executing dispatch remains reserved and must not be resent |

The only workflow control in this section is "Refresh workflow status", which
is read-only. Approval, apply, cancel, reconciliation and undo go through their
existing guarded paths and stay explicit. The panel never offers a resume or
retry action for a status row and never treats `applied_unverified`,
`uncertain` or `mayHaveMutated` as completion.

Text labels carry the meaning independently of colour or animation. Unavailable
status is labelled unavailable; an active lease says that redispatch is not
allowed. The presentation does not claim that fake-host evidence is real
After Effects evidence, and it does not expose raw provider transcripts,
approval tokens or generated host code.

## Consequences

- Users can see progress, evidence, blockers and recovery boundaries without
  reconstructing them from a transcript.
- The panel remains a presentation boundary; the sidecar remains the sole
  workflow authority.
- Polling is bounded, de-duplicated and read-only. A failed poll cannot wake a
  provider or submit a command.
- Panel and fake-host tests cover blocked or leased, verified, uncertain,
  provider-failure and unavailable projections. Real-host validation separately
  establishes undo grouping, read-back, callback loss, and the limits of
  visual and temporal evidence; no green UI state substitutes for those
  observations.

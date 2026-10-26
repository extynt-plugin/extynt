# ADR 0033: workflow recovery status and the restart boundary

Status: accepted

## Context

`workflow-v1` keeps a durable sidecar ledger and a deliberately narrow restart
contract. The status projection is useful to a panel operator, but the field
`resumeSupported` is easy to misread as permission to resend a host command or
wake a provider. The product surface must make recovery facts visible without
turning inspection into an execution control.

The sidecar exposes a bounded, read-only `GET /v1/workflow/status` projection.
It includes job, stage and batch lifecycle, execution and verification
evidence, mutation state, the active dispatch lease, provider failures,
divergence, and a bounded continuation view.

## Decision

The panel diagnostics drawer polls the workflow status endpoint after pairing
and offers a manual refresh. It presents:

- recovery classification and whether explicit reauthorization is required;
- active job and batch lifecycle;
- execution, verification and mutation as separate facts;
- provider and divergence blockers; and
- whether a host dispatch lease is still active.

The status surface has no resume, retry, approve or provider-continuation
button. A durable projection is an inspection surface only. `resumeSupported`
means that the ledger and its recovery classification can be reconstructed; it
never means automatic host dispatch, automatic provider continuation, or safe
mutation replay. Claimed, executing, lost-receipt, uncertain, failed, rejected
and unverified work remains visible and blocked until explicit reconciliation
or user action.

A status request failure does not initiate a repair, retry or mutation attempt.

On restart the sidecar preserves settled evidence, keeps claimed and executing
work blocked, discards volatile handoffs and approval capabilities, and never
redispatches a mutation.

## Consequences

- Operators can distinguish a blocked host lease from an idle workflow and see
  why a job is not progressing without reading sidecar logs.
- Recovery classification is visible without leaking approval capabilities or
  turning the panel into a second workflow authority.
- Tests against a fake plugin verify projection wiring and the no-redispatch
  claim. They cannot prove the restart behavior of a real After Effects process
  or host undo; callback loss, read-back and undo-group behavior need
  real-host validation.
- Plan cards keep their own receipt and undo presentation; the workflow drawer
  does not reinterpret those cards or synthesize receipts.

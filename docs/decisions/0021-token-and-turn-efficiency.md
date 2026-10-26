# ADR 0021: Token and turn efficiency

## Decision

The local agent interface treats token use and avoidable agent turns as
acceptance criteria. `ae_get_bootstrap_context` is the first read in a task:
it returns only profile/project/selection identities, counts, change signals,
and the recommended next read. It never returns capability entries, property
trees, preset inventory, or a project graph.

Profile reads accept `knownProfileId`; when unchanged they return
`NOT_MODIFIED` with current identifiers only. Search returns compact rows;
controls, usage, and evidence are explicit paged detail reads. Responses state
a byte budget, pagination/truncation markers, and stable IDs rather than
embedding large local schemas.

## Measurable budgets

- Bootstrap, profile status, and `NOT_MODIFIED`: at most a few KB (currently
  advertised as 2 KB, 12 KB for compact search pages, and 512 bytes when
  unchanged).
- Default receipts remain concise: outcome, changed IDs, verification basis,
  and bounded error. Debug detail must be explicitly requested.
- One intent should produce one bounded plan for create, populate, and animate
  once deterministic host placeholders are supported.

## Deferred implementation

This increment implements bootstrap identity reuse, compact profile search,
and `NOT_MODIFIED` for profile reads. It also supports deterministic earlier
`create_layer` references (`__new__:layerN`), including typed text animator
selector animation and ensured effect controls, in one bounded plan (up to 64
operations). It does not yet implement project delta tools for every project
read, receipt `detail=debug`, same-plan effect-control aliases beyond exact
paths, or a zero-click `ae_execute_plan`.

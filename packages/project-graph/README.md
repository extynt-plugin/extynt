# Project graph

Normalized, serializable representation of the open After Effects project and query utilities used by both explanation and target resolution.

## Snapshot contract

`ProjectSnapshot` is deliberately a host-neutral data contract. It captures the active composition, selection, composition/layer structure, persistent layer IDs, and stable `matchName` property paths. Query functions are pure and deterministic, so they can be used by an MCP adapter, a panel, or fixture tests without importing After Effects APIs.

The schema currently targets the newest/current Creative Cloud baseline used by the project spike: After Effects **26.2.1 (Build 2)**. Every snapshot carries `host.version` (`app.version`), string-safe `host.buildNumber`, optional `host.buildName`, platform, and architecture. A future adapter must reject or explicitly mark snapshots from unsupported host versions; this package does not silently downgrade, translate, or provide compatibility shims.

`fingerprint` is a stable, dependency-free graph identifier (FNV-1a over canonical JSON, excluding capture time and the fingerprint itself). It is suitable for stale-plan checks, not for security or signatures. `revision` remains an adapter-provided token and must change after a host mutation.

The hand-authored `src/fixtures/representative.ts` fixture exercises two compositions, duplicate layer names across compositions, selection, persistent IDs, nested `matchName` property paths, a Gaussian Blur effect, and enabled/disabled expressions.

## Design rules

- **Transport independence.** `ProjectSnapshot` is a serializable data contract. It imports no Adobe SDK and assumes no transport (plugin link, MCP, HTTP); whatever reads the host owns the conversion from After Effects' object model into this shape, and any transport can evolve independently as long as it emits this versioned contract.
- **Snapshot shape.** Exact host metadata, project metadata, an adapter revision token, a deterministic graph fingerprint, the active composition and selection, compositions, layers, relationships, and property paths keyed by `matchName` rather than localized display names. It does not attempt to represent every After Effects object; additions need a schema version decision and representative fixtures.
- **Identity.** Persistent layer IDs are strings and composition IDs are adapter-provided stable strings. Names and indexes are descriptive query fields and never the sole identity of a mutation target. A query that resolves no layer is `missing`; a name that resolves several is `ambiguous` and must not be executed directly.
- **Host version.** `host.version` is mandatory so consumers apply an explicit support policy; this package contains no backward-compatibility layer.
- **Effects and expressions are derived, not stored.** The normalized views are computed from the snapshot, so identity-bearing data is not duplicated in fingerprints and the wire contract stays backward-compatible. Effects are recognized by the `ADBE Effect Parade` matchName and its direct child groups, or by an explicit `PropertySnapshot.kind` of `effect`. Expressions are found at every property depth when authored or marked enabled, and disabled authored expressions stay visible. Project-wide results always carry composition ID and persistent layer ID.

## Effects and expressions

`extractEffects(layer)` normalizes the observed After Effects effect-parade
shape into `EffectSnapshot` values. It recognizes the stable `ADBE Effect
Parade` matchName and also accepts future host entries marked
`kind: "effect"`; it never classifies by localized display names. Each effect
retains its stable path, matchName, enabled state when available, child
properties, and nested expressions.

`extractExpressions(layer)` returns authored expressions at any property depth.
The project-wide `queryEffects` and `queryExpressions` helpers return
composition/layer identity with each match. `getSelectedLayerEffects` and
`getSelectedLayerExpressions` scope those queries to the current selection.
These are pure read-only projections over `ProjectSnapshot`; they do not add a
mutation surface or require an After Effects runtime.

The host probe may omit effect enabled state, in which case the normalized
value is `null`. Disabled but authored expressions remain queryable, so an
explanation surface can distinguish “has an expression” from “expression is
currently enabled.”

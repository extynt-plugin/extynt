# ADR 0010: Snapshot identity and bounded observation

- Status: Accepted
- Date: 2026-09-11

## Decision

The normalized snapshot uses AE layer/item IDs plus composition identity as
primary references. Property paths use slash-delimited `matchName` segments.
The canonical fingerprint is a Merkle SHA-256 hash (`fp3-` plus 32 hex digits)
of recursively sorted JSON: each layer has a digest, a composition hashes its
own fields with its layers' digests, and the project hashes its own fields with
the composition, item and source digests. Capture time, current time, UI
selection, warnings and truncation metadata are left out. A fingerprint in the
earlier 8-digit FNV-1a form never equals a current one, so anything that
carries it is stale, and so is one in the `fp2-` form, which read the order of the
compositions, items and sources as content. Layer and property order remains
significant; the project-panel lists hash as sets, because After Effects lists a
new item in another place right after it is made than a read taken later does.
The host
also emits a bounded revision hint; consumers must treat it as an observation
token, not a globally durable ID.

Every host traversal has composition, layer, property-depth, property-count,
and byte limits. Truncation is explicit and warnings are retained outside the
identity hash. Missing or unsupported host fields become null/unknown with a
warning rather than aborting the whole read-only snapshot.

## Consequences

Repeated reads of an unchanged project can compare fingerprints without being
coupled to wall-clock time or selection. Reordering layers correctly changes
identity; reordering compositions or items does not. Layer IDs are only stable within the relevant AE project identity;
copied, recreated, or imported projects require re-resolution. The current
ExtendScript implementation can only provide a conservative revision hint;
strong mutation revisions remain a future host-adapter concern.

## Evidence

Canonicalization and reorder behavior are automated in
`packages/project-graph/tests/project-graph.test.ts`. Rich AE field availability
and repeatability remain unverified until the batched Mac session.

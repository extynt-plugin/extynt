# ADR 0020: Cached Host Capability Profile

Status: accepted

The agent queries a versioned Host Capability Profile before choosing effects or
properties. It keeps curated/documented semantics separate from live installed,
observed, probed, inferred, unsupported, and unknown evidence. Profile identity
is the host version/build/platform plus an order-independent shallow effect
inventory fingerprint and catalogue/schema versions.

Startup performs no project mutation and builds only shallow installed evidence.
An unchanged identity reuses the prior profile; changed entries are marked
`probeNeeded`. Deep control discovery is an explicit disposable Capability Lab
operation, never an automatic working-project scan. Truncated inventory is not
evidence of absence. Compact search/describe tools return bounded results and
fallback descriptions for uncurated installed effects.

The companion versioned Native Operation registry distinguishes the broader
typed AE DOM surface from effects and presets. Its machine-readable entries
state exact DOM targets, host gates, verification bases, and whether an
operation is implemented, documented-only, probe-needed, or unsupported; the
agent reads it through compact MCP summary/search/describe tools.

The first-party baseline is a semantic reference for project/composition/layer,
transform, timing, parenting, visibility, text, masks, shapes, cameras, lights,
audio, effects, expressions, and render/import families. It does not imply that
every documented surface is executable: operation status remains separate.

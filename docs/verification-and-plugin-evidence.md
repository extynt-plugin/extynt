# Verification and plugin evidence model

This work freezes the operation vocabulary. It improves how existing behavior is measured and proven; it does not add After Effects features.

## Four claims that must remain separate

1. **Implemented** means extynt has a typed operation, validator, compiler, and host executor path.
2. **Live-matrix supported** means a named verification kit passed on one exact After Effects build. This is compatibility evidence, not proof of a later user apply.
3. **Receipt verified** means one apply was followed by a fresh observation and every required requested field compared successfully. This is the default meaning of `verified` in product state.
4. **Visual/temporal reviewed** means sampled frames or a person confirmed behavior that structure alone cannot establish.

A successful host call is only execution evidence. A live-matrix ledger entry may remove the pre-approval “never tested on this build” warning, but it must not upgrade a later apply to `verified`; that later apply still needs its own receipt observer.

## Host verification path

```text
typed request
  -> deterministic validation
  -> compiled host command
  -> one AE undo group
  -> host response
  -> settle
  -> fresh project probe / bounded host readback
  -> pair requested operation with observed result
  -> exact, partial, failed, or unavailable verdict
  -> receipt + runtime evidence for this host build
```

Unknown mutation, timeout after dispatch, missing readback, partial fields, coerced values, and expression-driven motion must not be collapsed into success. A later failure supersedes older success evidence for the same operation and host build.

The read-only coverage command exposes the current migration queue:

```bash
node tools/host-verification/dist/src/cli.js coverage
node tools/host-verification/dist/src/cli.js coverage --host-key "26.2.1 (2) macOS/arm64"
```

It groups existing operations into exact receipt observers, partial observers to strengthen, missing structural observers, host-returned evidence paths, and scripting-unobservable behavior. It does not execute After Effects.

## Third-party plugins

After Effects exposes many plugins primarily through effect match names. A match name proves identity only; installation proves availability only. Neither fact proves safe values, stable controls, licensing, render availability, or a visually correct result.

The plugin map therefore records:

- vendor and package identity separately from each effect match name;
- package version and exact host build;
- whether the package is required or optional for a benchmark;
- control schemas only when documented or probed;
- runtime and license requirements;
- evidence sources (documentation, inventory, control probe, receipt, visual review);
- quarantine on version mismatch or unprobed controls.

Adobe-bundled capabilities, explicitly registered third-party packages, user presets, and unknown-provider inventory remain separate. An unregistered installed effect stays `unknown`; it is never silently treated as Adobe or promoted to a known semantic capability.

For benchmark runs, a missing required plugin is an environment incompatibility. A missing optional plugin is a classified skip or an explicitly expected fallback. Neither should count as a model-quality failure.

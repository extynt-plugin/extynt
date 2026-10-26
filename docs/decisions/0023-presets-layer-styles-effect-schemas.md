# 0023: Effect control schemas, typed presets, and Layer Styles

Date: 2026-09-14 · Status: accepted

## Context

The minimum bar for a usable After Effects copilot included three things the
agent could not do safely: know an arbitrary effect's controls (paths, ranges,
menus) before writing to them, apply an installed Animation Preset, and add a
Layer Style. Live probes on AE 26.2.1 (probe scripts since removed;
they established the host facts:

- All 460 installed effects add, read, and remove by script; each control tree
  has type, default, min/max, and dropdown items.
- `Layer.applyPreset(File)` works on the selected layer; results are
  observable as added effects, animators, keys, and expressions.
- Layer Styles cannot be added with `addProperty` or `enabled = true`
  (`canSetEnabled` is false) until the Layer > Layer Styles menu command
  (ids 9000–9008) runs on the selected layer; afterwards `enabled` is settable.

## Decision

**Effect control schemas.** No control schema ships. Control trees (paths,
ranges, menus) come only from the user's own machine: the collector probes the
installed effects at runtime and the result lives in the per-user profile
(the probed-effects state file and the host profile built from it). Both feed the
host profile, so `ae_describe_host_capability detail=controls` pages real
schemas for curated and uncurated effects on the host that was probed, and
nothing about any plug-in, Adobe-shipped or third-party, is seeded from the
repository. Live evidence is authoritative over curated names and types;
curated entries keep only their semantic roles. `ensure_effect` accepts
`host:<matchName>` for any installed effect. A new `set_effect_control` writes
a static value to a control without keyframes; `ae_propose_plan` rejects
out-of-range numbers, invalid menu item numbers, wrong vector lengths, and
non-0–1 colors before approval. Tests exercise these paths against a synthetic
fixture (host built-in matchNames plus invented fake-vendor effects), never a
captured plug-in census.

This corrected a catalogue bug: curated Gaussian Blur mapped Repeat Edge
Pixels to `-0002`, which is Blur Dimensions on AE 26 (`-0003` is Repeat Edge
Pixels).

**`apply_preset`.** Plans carry only a host-profile `presetId`. The sidecar
resolves the absolute `.ffx` path from the scanned preset roots when it
compiles the command handed to the paired panel; agents never send or receive
a path, and a preset deleted after proposal fails at approval with
`PRESET_NOT_FOUND`. The host opens the target composition in the viewer if
needed, selects only the target layer, calls `applyPreset`, and reports a
bounded before/after structure delta (`added`). The user's viewer and
selections are restored whether the plan succeeds or fails. Verification is
`exact` when the fresh snapshot's effect count matches the host's after
summary, and `applied_unverified` when the preset made no observable
structural change.

**`ensure_layer_style`.** A fixed style enum (drop-shadow, inner-shadow,
outer-glow, inner-glow, bevel-emboss, satin, color-overlay, gradient-overlay,
stroke) maps to a style matchName and menu command id in a table mirrored by
the host and enforced by a parity test; the host refuses any id it does not
know. An already-added style is toggled through `enabled`; a missing style is
added with the menu command on the isolated layer and read back. Optional
`values` set up to 16 static settings keyed by the style's own setting
matchNames (`dropShadow/distance`, `frameFX/size`, ...); settings from another
style or with keyframes are refused, and receipts verify each value. The probe
now records `enabled` for effects and Layer Style groups, so style state is in
the fingerprint and receipts verify it exactly. Pattern Overlay has no menu
command and is not offered. `ae_inspect_layer` names enabled styles and stops
folding their values as noise.

## Consequences

- Presets and menu commands are `undoability: host-dependent` in the registry:
  whether `applyPreset` and `executeCommand` join the plan's undo group is not
  yet verified live. `ae_undo_plan` already reports `undo_unverified` with
  differences if one Undo does not restore the pre-plan state.
- Presets can trigger host dialogs (for example missing fonts); the queue's
  `stalled` pipeline state is the signal.
- Schemas exist only after a local probe, so a fresh install describes uncurated
  effects as `probeNeeded` until the collector has run; a probe on another host
  version simply replaces them per effect.
- Superseded wording: the first release of this ADR described a bundled AE 26.2.1
  schema file. That file was removed under the no-shipped-host-data rule and
  the runtime has no loader for one.

# Effect value notes

The storage, API and rules for effect value notes, usage learning, variant sets
and unit/range reporting. The notes tools are `ae_read_effect_notes` and
`ae_write_effect_note`; the sidecar code is `apps/sidecar/src/effect-notes-*.ts`.

## Kinds and where each lives

| Kind | Stored as | Counts toward cap | Written by |
|---|---|---|---|
| `observed` | Existing `definition_sources` + `parameter_definition_facts` (native-observation). Projected read-only into the notes read. | No (facts, not notes) | Catalogue collector, unchanged |
| `measured` | `effect_value_notes` row, `kind='measured'` | Yes | Calibration only (sidecar-internal; never an MCP write) |
| `agent-inferred` | `effect_value_notes` row, `kind='agent-inferred'` | Yes | `ae_write_effect_note`, only for plugins the user opted in ("Document this plugin") |
| `usage` | `effect_value_usage` rows; stats computed on read | No | Derived automatically from verified, not-undone applies and from values seen in project snapshots, while "Learn from my work" is on |

All tables are additive, created idempotently in the **host catalogue file**
(`graphs/host-catalogue.extynt`), the same way `GRAPH_CATALOGUE_TABLES` is: no
schema-version bump. Nothing is seeded or shipped; every row comes from this
machine at runtime.

## Identity and staleness

A note is keyed to `match_name` (effect) + `control_path` (the parameter
definition path, e.g. `ADBE Gaussian Blur 2-0001`; `NULL` = effect-level note).
Each row also records `effect_version` (AE-reported effect version, may be null)
and `ae_build` (the AE version/build string from the host key) at write time.

Lookups use `match_name` (+ `control_path`), **not** the host key, so notes
written under an older AE build or plugin version stay visible. On read, a note
whose `effect_version` or `ae_build` differs from the current host's is returned
with `stale: true` and a `staleReason` (`"effect-version"` / `"ae-build"`).
Stale notes still count toward the cap (so agents curate them out).

## Caps (tunable)

- At most **5** current notes per effect (effect-level + all controls), and
  **2** per control. Defaults come from `effectNoteCaps()`; overridable with
  `EXTYNT_NOTES_PER_EFFECT` / `EXTYNT_NOTES_PER_CONTROL` (integers 1..20).
- Usage stats and observed facts never count.

## Read before write

Every write carries `expectedNoteIds`: the IDs of the effect's current notes
exactly as the last read returned them (order-insensitive set; effect scope, all
controls). If the stored set differs, the write is rejected with
`EFFECT_NOTES_STALE` and the response includes the current notes (same shape as a
read) so the caller can retry without another round trip.

## Replace, don't append

If adding the note would exceed either cap, the write must name `replaces`
(a current note ID) and `reason` (one line, 1..160 chars, no newlines).
The replaced note must be in scope: for a control-cap overflow it must be a note
on the same control; for an effect-cap overflow any current note of the effect.
Otherwise `EFFECT_NOTES_CAP_REACHED` (with the current notes and which cap).
`replaces` may also be used below the cap (a plain correction).

Replaced notes move to hidden history: `state='replaced'`, `replaced_by`,
`replace_reason`, `replaced_at`. History is never returned by the agent read.

History operations (user-facing, panel / HTTP only):
- **audit**: list history for an effect (or all), newest first, bounded.
- **restore**: bring a replaced note back to `current`; obeys the same caps and
  read-before-write (`expectedNoteIds`, and `replaces` + `reason` at cap).
- **forget**: hard-delete one history note, all notes for an effect, or all
  notes for a plugin.

## Note text

`text`: 1..280 chars, single paragraph (newlines collapsed), trimmed. Optional
`value` (finite number or array of 2–4 finite numbers) for notes about a
specific value (e.g. measured: "at 40 the glow covers ~30% of frame"). Notes are
plain labelled claims; the read labels each with its kind and trust:
`measured` → `evidence`, `agent-inferred` → `labelled-guess`.

## Plugin opt-in ("Document this plugin")

AE does not report a plugin/vendor for an effect (`plugin_definitions` is empty
in practice), so the **plugin key is the effect's AE menu category** from
`installed_effects.category`, falling back to the match name when the category
is empty (the best runtime-only grouping available). Opt-in rows: `effect_note_plugin_optin(plugin_key PRIMARY KEY,
enabled_at)`. `agent-inferred` writes for an effect whose plugin key is not
opted in fail with `EFFECT_NOTES_DOCUMENTATION_OFF`. Off by default for every
plugin, including Adobe's.

## Usage learning ("Learn from my work")

- Setting `learnFromWork` (default **true**) persisted in the sidecar's
  per-user settings alongside other panel settings.
- Sources:
  - `kept`: after a plan's receipt is verified, each `set_effect_control`
    value is recorded once; when that plan is undone its
    contribution is removed (keyed by plan ID), so only kept values remain.
  - `seen`: effect control values present in accepted project snapshots
    (deduplicated per project/layer/effect/control so a re-read never
    double-counts).
- Stored per (match_name, control_path, source) with numeric scalar values only
  (vectors stored as JSON for display, excluded from numeric stats). Bounded:
  at most 64 distinct value rows per control per source (oldest evicted).
- Read returns computed stats per control: `count`, `min`, `max`, `median`,
  `recent` (last ≤3 kept values). Never counts toward the cap.
- **Forget** deletes all usage rows (and the plan-contribution index).
- When the toggle is off nothing new is recorded; existing rows stay until
  Forget.

## Authority

Notes never override `observed` facts (observed facts are returned first and
separately; a note cannot change type/range/default) and never authorize a
write: every notes response carries `writeAuthorizing: false`, and nothing in the
plan, apply or verification path reads notes. Applying a value still goes
plan → readback → verification.

## MCP surface

- `ae_read_effect_notes { matchName, controlPath? }` → `{ effect, observed,
  notes[], usage, noteIds, caps, documentationEnabled, writeAuthorizing:false }`.
  `noteIds` is the exact set to echo as `expectedNoteIds`.
- `ae_write_effect_note { matchName, controlPath?, text, value?,
  expectedNoteIds, replaces?, reason? }` → kind is always `agent-inferred`.
  Advertised to external agents and the in-panel agent.

## Calibrate (measured)

The store accepts `measured` notes through an internal function that a
calibration flow calls; there is no MCP write for `measured`, and no render
sweep produces them yet.

## Usage memory beyond control values

The same local, toggle-governed usage store also learns which effects (and,
where cheap, fonts, presets and kept animation timings) the user actually
reaches for, so the agent starts from their habits:

- **Effect ranking**: per effect, `kept` = times an applied, not-undone plan
  added or edited it; `seen` = distinct layers carrying it in observed projects.
  The agent briefing lists the user's most-used effects (top ≤ 8, names only),
  and host-capability search uses usage as a tie-breaker after relevance.
- **Soft preferences**: most-used fonts and presets , and the median
  duration / easing of kept keyframe animations (see "Animation habits").
- All of it is a preference, never a fact or an authorization; it is shown
  labelled as "your usage", obeys "Learn from my work", and Forget clears it.

### Effects, fonts and presets

- Table `effect_usage_events(kind effect|font|preset, name, source kept|seen,
  plan_id, slot, recorded_at)`, bounded (20000 rows overall, 1000 per name and
  source, oldest evicted). `kept` rows are one per (plan, kind, name); `seen`
  rows are one per (kind, name, layer), so a re-read refreshes instead of adding.
  Undo (`unrecordPlanUsage`) and Forget clear them with the value rows.
- A plan counts only when its receipt verified (`statusFromApplyReceipt` =
  `verified`) and only for steps whose outcome row is verified (`confirmed`,
  `host_confirmed`, `coerced_equivalent`). `ensure_effect`, `set_effect_control`
  and `animate_control` count toward the effect; static
  numeric/vector values (and keyframe values) become kept control values;
  `set_text_document` fonts and `apply_preset` presets feed the font and preset
  lists.
- An undo receipt unrecords the plan only when it succeeded and every undo group
  of a known plan has run; a partial undo changes nothing.
- A ranking is `used = kept + seen` (distinct plans plus distinct layers), ties by
  `kept`, then name. It feeds one briefing line ("Your usage ..."; omitted when
  learning is off or empty), the tie-break of `ae_search_host_capabilities` (a
  tie only, never what matches; rows may carry `used`) and `effectUsage` in
  `ae_read_effect_notes`. None of it is a fact or an authorization.

### Animation habits

- Table `animation_habit_samples(plan_id, slot, property_kind, duration, keyframes, easing, influence, recorded_at)`,
  unique per (plan, slot), bounded (4000 rows overall, 200 per property kind, oldest evicted). Written by the same
  hook as kept values (`learnKeptFromReceipt`, so only a fully verified plan and only its verified steps), gated by
  "Learn from my work", tombstoned by the same plan index so a late record for an undone plan is ignored, removed by
  undo (`unrecordPlanUsage`, whole-plan undo only) and cleared by Forget.
- One sample per verified `animate_property` / `animate_control` step with at least two keyframes. `duration` is the
  first-to-last keyframe time in seconds (ms precision), `keyframes` the keyframe count. `property_kind` is read from
  the property path alone (no list of effects or properties): anything under `ADBE Effect Parade` is `effect control`;
  any other property is its last path segment without the `ADBE ` prefix and `#N` suffix, lowercased (`opacity`,
  `position`, `rotate z`, `mask shape`).
- `easing` is what the plan itself spelled out, per segment (the last keyframe starts none), in the host's own
  precedence: an explicit `ease` (speed 0 at about 33% influence is `easy-ease`, otherwise `bezier` with its mean
  influence), then `curve` (a named preset keeps its name, an object equal to a preset is named, any other is
  `bezier` with influence from x1 and 1 - x2), then `interpolation` (`linear`, `hold`, `bezier`, any EASE_* is
  `ease`). The most common label across segments wins (ties to the later one); nothing spelled out is `default`,
  which is never claimed as a preference.
- Computed on read (`computeHabits`): per property kind with at least three samples the median span (rounded to
  0.05 s under a second, 0.1 s under ten, 0.5 s above), the most common easing (ties to the more recent, then
  alphabetical), the median keyframe count and, for bezier, the median influence; and an overall median over all
  samples, also from three. Fewer than three samples says nothing.
- Surfaced three ways, all labelled a preference ("an explicit request always wins"): one extra clause in the
  briefing usage line ("animations usually run ~0.6 s with easy ease"; omitted with no habits, while learning is off,
  or when no easing was ever spelled out); `animationHabits` on `ae_read_effect_notes` (null while learning is off or
  under three samples); and a `learned` count object in `GET /v1/notes/settings` that the panel's Memory section shows
  as "Learned so far: N effects, M fonts, animations ~0.6 s" (cleared on Forget; whatever is stored, even with
  learning off).

## Variant picker and its previews

For "make the glow subtler" the agent MAY offer the user a choice instead of guessing one value. Nothing here is
canned: the control, the values and the labels all come from the model; code has no multipliers and never derives one
value from another.

### The tool and the set

- `ae_offer_variants { target:{compositionId, layerId, effectPath, propertyPath}, effectMatchName, candidates:[{label,
  value}] (2-4), question? }`, on the in-panel agent's surface and the external MCP surface. The target is exactly a
  `set_effect_control` target and is validated by the same composer; a value is a finite number or 2-4 numbers.
- The control must be observed in the current snapshot as static (no keyframes, `expressionEnabled` not true) and hold a
  number or a number list of the same shape as every candidate. Otherwise it refuses, with a plain reason that points
  back to a normal plan (`VARIANT_CONTROL_NOT_OBSERVED`, `VARIANT_CONTROL_NOT_STATIC`, `VARIANT_CONTROL_NOT_NUMERIC`).
- Each candidate that is not the control's current value becomes an ordinary approval-required plan through
  `composeProposal` (the path `ae_propose_plan` uses: one `set_effect_control`, same digest, validation and approval
  policy). A candidate equal to the current value has no plan: choosing it applies nothing and closes the set.
- Sidecar state (`SidecarState.variants`, in memory, like the plan store): set id, status `open | picked | dismissed`,
  reason, the model's question, the snapshot fingerprint the plans were written against, and the candidates (label,
  value, plan id or none). A new set for the same control supersedes the old one. A refusal after the first plan was made
  withdraws it, so a refusal leaves nothing behind.
- Auto-apply cannot reach an option: the tool is not a plan-card tool, so no card with `autoApply` is returned and
  nothing enters the commit queue; and `ae_approve_plan` refuses any option that is not the picked one of a picked set
  (`VARIANT_NOT_PICKED`), `ae_amend_plan` refuses to change one (`VARIANT_PLAN_FIXED`). Plan ids are never returned to
  the model.

### Choosing

`GET /v1/variants` and `POST /v1/variants/choose {setId, choice: <index> | "none"}`, paired panel only
(`X-AE-Panel-Instance`). A choice approves nothing itself:

- `none` cancels every plan in the set; the current value closes the set and cancels every plan; any other index checks
  the project has not changed since the set was offered (`VARIANT_SET_STALE`, plain words, set closed, all plans
  cancelled), that the plan's approval has not lapsed (`VARIANT_SET_EXPIRED`, 10 minutes) and that the plan is still
  unapplied, then cancels the others and returns the one plan as an ordinary plan card.
- The panel then runs that card through the normal approval, apply, read-back and verification path, with its
  before/after thumbnails and Undo like any plan. If the project changes between the pick and the apply, the ordinary
  apply refusal says so.
- **Usage vote.** The picked value is recorded by the existing `kept` path when the chosen plan's receipt verifies (and
  removed when it is undone), under "Learn from my work". No separate "picked" signal was added: that would need a new
  `source` in the usage tables, and the kept value already is the vote.

### Previews (the calibration render)

`aePreviewControlValues` (the host library, `apps/panel/host/preview.jsx`) reads and remembers the control's exact value, and for each
candidate sets the value (unless the control already holds it), saves a frame through the ordinary `aeCaptureFrame`,
then restores the original, reads it back and reports `restored` (exact, component for component).

- **One undo group, named "extynt preview".** Opened before the first write, closed after the restore (the restore is
  in a `finally`, so an error never leaves a candidate on the control). The group has no net change, but it is still one
  step on After Effects' Undo stack: a script cannot discard a group, and the host does not press Edit > Undo to remove it
  (it cannot tell which step is on top). So the Undo history gains one empty "extynt preview" step per previewed set, and
  it also discards any Redo steps, as any edit does. It sits above earlier agent changes, so pressing the panel's Undo for
  a change made BEFORE the preview would take back the empty step first and the panel's verification would report that
  the undo did not restore the project (nothing is lost; Edit > Undo once more in After Effects). The preview is skipped
  when the Settings toggle "Show before/after thumbnails" is off.
- **Lease and quarantine.** The host scheduler classifies `aePreviewControlValues(` as a mutation, exactly as
  `aeApplyPlan(`/`aeUndoPlan(`: a durable mutation lease is reserved first, mutation listeners invalidate observations,
  and a call that never answers holds the lane to the same 15 minute deadline and then quarantines (`HOST_TIMEOUT`,
  connection badge "blocked", the sidecar told through the scheduler's own report). A restore that is not exact, a restore
  that throws, or an answer that cannot be read is also held as unresolved: the panel blocks natively and posts
  `PREVIEW_RESTORE_UNCONFIRMED`, which the sidecar records as an unknown native mutation (`recordUnknownNativeAccess`), so
  `/health` reports the quarantine until the sidecar is restarted, as for an unknown apply receipt.
- **When it runs.** Only when the panel is visible, After Effects is not busy, the host lane is idle, the set is open and
  not stale, and the toggle is on; at most once per set, retried at the next plan-list read for a few reads. Any other
  failure (a refusal, a frame that could not be saved, a script the host does not have) only means tiles without pictures.
- The thumbnails are small JPEGs in the panel (not stored, not sent); the PNGs are removed again.

## Units and position in the range

Agents see a control's unit label and where a value sits in its range, from what After Effects reported on this machine.

- **Collected.** The catalogue probe reads `Property.unitsText` (trimmed, at most 80 characters; an absent, non-text,
  empty or throwing answer is `null`) next to the existing `hasMin`/`minValue`/`hasMax`/`maxValue`. It lands in
  `parameter_definition_facts.units` of the native observation (native facts still carry no description or meaning) and
  in the probe evidence row (`u`) and `ControlSchema.units`, present only when AE reported a label.
- **Which range.** `minimum`/`maximum` are After Effects' valid range for the property. The narrower slider range its
  UI shows is not available to scripts and is never invented; every surface says "range as reported by After Effects".
- **The arithmetic.** `controlPosition` (capability-catalogue) is pure: for a single-number control (`OneD`) with a
  finite observed `min < max` it returns `position = (value - min) / (max - min)` and, when the observed default is a
  non-zero single number, `ofDefault = value / default`, both to 3 decimals. Menus, vectors, colours, other types,
  missing, one-sided, degenerate or contradictory ranges, and values outside the range return `position: null` with a
  reason. It never reads a name.
- **Where it shows.** `ae_describe_host_capability detail=controls` rows carry `units`. `ae_read_effect_notes` observed
  controls carry `units` and `defaultPosition` (where the factory default sits) plus a `rangeNote`; the notes read has no
  project snapshot, so it cannot give an instance's current position. `ae_list_effects_and_expressions` does:
  where the effect's controls were probed on this machine, a listed control reads `matchName|Name=25 (12.5% of 0–200
  pixels)`, and the full result carries `reportedRange` (`minimum`, `maximum`, `units`, `position`, `ofDefault`,
  `reason`, `source`). With no probe, or no range and no label, the listing is unchanged.

# Footage interpretation, image sequences, scene edit detection and analysis effects

Four additions to the typed plan surface. None of them runs a script the model wrote.

## What was added

| Plan type | Registry id | What it does |
| --- | --- | --- |
| `set_footage_interpretation` | `footage.interpretation` | Sets `FootageItem.mainSource` fields, reads every one back and fails the step on a mismatch. |
| `import_file` with `sequence` / `forceAlphabetical` | `footage.import` | Imports the numbered files beside `path` as one footage item. The receipt carries the item's duration, frame rate and whether it is a still. |
| `detect_scene_edits` | `footage.scene-edit-detection` | `AVLayer.doSceneEditDetection` in `markers`, `split` or `split-precomp` mode. The receipt lists the cuts. |
| (curated notes) | `tracking.stabilize`, `tracking.camera-track` | Warp Stabilizer and 3D Camera Tracker stay `ensure_effect` only and are marked user assisted with a new reason, `analyzes-in-background`. |

The snapshot's source rows carry an optional `interpretation`
(`nativeFrameRate`, `conformFrameRate`, `displayFrameRate`, `alphaMode`,
`premulColor`, `hasAlpha`, `loop`, `pixelAspect`, `fieldSeparationType`,
`invertAlpha`, `highQualityFieldSeparation`, `removePulldown`, `isStill`). A field After Effects will not answer is absent,
never guessed.

## Interpretation rules

- `conformFrameRate` 0..999 (0 asks for the file's own rate), `alphaMode`
  `ignore | straight | premultiplied`, `premulColor` `[r, g, b]` 0-1 (only with
  `alphaMode: "premultiplied"` in the same operation), `loop` a whole number
  1..9999, `pixelAspect` 0.01..100, `fieldSeparationType`
  `off | upper-field-first | lower-field-first`.
- `invertAlpha` and `highQualityFieldSeparation` are booleans. `guessAlpha` and
  `resetFrameRate` must be `true` when set. `guessAlpha` cannot be combined with
  `alphaMode` or `premulColor`, and `resetFrameRate` cannot be combined with
  `conformFrameRate`.
- `removePulldown` is `off`, `WSSWW`, `SSWWW`, `SWWWS`, `WWWSS` or `WWSSW`.
  `guessPulldown` is `pulldown-3-2` or `advance-24p`. The two cannot be set in
  the same operation. Both map to After Effects' `PulldownPhase` members in
  `apply-footage.jsx`; the member names are not confirmed without After Effects
  (see the list below).
- The host refuses a non-file source. On a still it refuses `conformFrameRate`,
  `loop`, `fieldSeparationType`, `highQualityFieldSeparation`, `removePulldown`,
  `guessPulldown` and `resetFrameRate` (`FOOTAGE_STILL_INTERPRETATION`). On
  footage with no alpha channel it refuses `alphaMode`, `invertAlpha` and
  `guessAlpha` (`ALPHA_MODE_UNAVAILABLE`).

## Scene edit detection rules

- Refused up front from the snapshot: a layer that is not a footage layer
  (`SCENE_EDIT_NOT_VIDEO`) and a layer with time remapping on, keyed or driven
  by an expression (`SCENE_EDIT_TIME_REMAPPED`).
- Refused by the host: a missing `doSceneEditDetection` or enum member
  (`SCENE_EDIT_UNSUPPORTED`, After Effects before 22.3), time remapping on,
  no video or a still source, and a throwing call (`SCENE_EDIT_FAILED`).
- The cut list is the host's own diff: marker times before and after, or the
  layers the composition gained. After Effects' return value is not trusted.
  The list is capped at 200 with a `cutCount` and a `truncated` flag. Refresh
  the snapshot afterwards.

## Analysis effects: what can and cannot be known

Warp Stabilizer (`ADBE SubspaceStabilizer`) and 3D Camera Tracker
(`ADBE 3D Tracker`) can be added with `ensure_effect`, and the analysis then
runs in the background. No script property that extynt could confirm reports
whether the analysis has finished, so the plan does not claim it. The effects
are marked user assisted with the reason `analyzes-in-background`; the plan
notice and the effect note tell the agent to say that the analysis was started,
that the user watches the banner in the Effect Controls panel, and (for 3D
Camera Tracker) that Create Camera and Create Null are buttons only the user
can press. Nothing blocks the main thread waiting for it.

## Behaviour only a live After Effects can confirm

The unit tests use the fake host, so these points depend on After Effects itself
and are worth checking on a real project when this code changes:

1. `FootageItem.mainSource` writes: `conformFrameRate`, `alphaMode`,
   `premulColor`, `loop`, `pixelAspect`, `fieldSeparationType` each stick, and
   the read-back compares equal. Watch float rounding in `pixelAspect` and
   `conformFrameRate` (the compare tolerance is 0.0001).
2. Whether `conformFrameRate = 0` means the native rate. The read-back skips
   comparing a zero request until this is known.
3. Whether `AlphaMode` / `FieldSeparationType` enum members match the names
   used (`IGNORE`, `STRAIGHT`, `PREMULTIPLIED`, `OFF`, `UPPER_FIELD_FIRST`,
   `LOWER_FIELD_FIRST`), that the `PulldownPhase` members (`OFF`, `WSSWW`,
   `SSWWW`, `SWWWS`, `WWWSS`, `WWSSW`) exist, and that `premulColor` is writable
   only while the mode is premultiplied.
4. `ImportOptions.sequence` / `forceAlphabetical` on a numbered sequence, that
   `importFile` returns one footage item, and what `duration` / `frameRate`
   it reports.
5. `AVLayer.doSceneEditDetection` in each mode: the return value (not used), the
   marker times and new layers the diff reports, behaviour on a precomp layer
   (the validator lets it through), whether `split-precomp` creates new layers
   or only precomps, and how long a long clip blocks the main thread.
6. Undo: one `Cmd/Ctrl+Z` should remove the whole scene edit detection result.
7. Warp Stabilizer / 3D Camera Tracker: whether any property or the Effect
   Controls state is readable by script once analysis is running. If one is
   found, the user-assisted reason can become a real read.

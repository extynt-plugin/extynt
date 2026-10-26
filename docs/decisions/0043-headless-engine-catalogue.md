# ADR 0043: the effect catalogue is collected in a hidden, private After Effects

Status: accepted. Amends [0014](0014-host-capability-catalogue.md) (where collection runs) and
[0041](0041-install-and-privilege-model.md) (an install-time step).

## Context

ADR 0014 collects catalogue facts at runtime on the user's host, and 0023 keeps it that way: nothing about any
effect, Adobe's or a vendor's, ships. The collector first probed effects in the After Effects the user works
in, in an empty scratch project between their actions. On a real Mac with third-party and bundled vendor
effects that went wrong in ways a user sees:

- Remove Grain (`VISINF Grain Removal`, bundled with After Effects) crashed the user's After Effects, twice.
- A third-party effect and others raised "Unable to execute script at line 1" dialogs after the probe returned, holding After
  Effects for up to 43 s; the collector could not attribute them.
- Depth Generator left items in the scratch project and stopped collection.
- To stay safe the collector probed plugins one at a time and stopped all plugin probing after any crash, so
  third-party coverage, the part users care about, stayed incomplete.

## Decision

1. Probe pages run only in a private After Effects the sidecar starts for the purpose: the user's own copy of the app,
   opened hidden as a second instance with `-noui -extynt_engine` (`open -g -j -n`), never in the After Effects the
   user works in. The user's After Effects is only offered read-only reads of effects already in their own project.
2. The sidecar launches and supervises the engine (`catalogue-engine.ts`): it waits for the endpoint, asks the
   census, runs pages, and replaces the engine when it crashes, stalls or pauses. A crash costs an engine, not the
   run: the host breadcrumb names the effect, that effect is retired, and the rest of its page is paged again.
3. In that instance the plugin sees `-noui` and runs in engine mode: it makes the process background-only (no Dock icon
   after the first seconds of start-up, never the active app, no window), cancels within a quarter second any dialog an
   effect opens, publishes `native-engine.json` (never the user's `native.json`) and never starts the sidecar. A page
   that stops answering (25 s) is treated like a crash: the instance is stopped by pid and the breadcrumb retires the
   effect. A version whose After Effects the user has open is not started a second time.
4. Engine pages run whole (no time budget) and replace a dirtied untitled project; plugins are paged like Adobe
   effects.
5. The first collection runs right after install in extynt Catalogue.app, a small signed window (no Dock icon) that
   postinstall opens as the signed-in user: a line per After Effects version, a bar and a summary of what was learned
   and skipped. The package finishes at once and never fails on it. The installer itself runs no check script and has
   no plugin page, because either makes Installer warn that the package "will run a program"; package scripts cannot
   drive Installer's own status line either (measured). Checks live in preinstall. Without a GUI session, and
   afterwards, a census that shows effects the catalogue lacks starts the engine for that version once per sidecar
   run.
6. Collection never touches a user project: `POST`/`GET /v1/catalogue/engine` need only the session token.
7. After Effects may stay open during install: the plugin loads the next time it starts (the window says so).

Still runtime-only, still on this machine: 0014's and 0023's rule that nothing is seeded or shipped is unchanged.

## Why the full app, not the headless render engine (measured on AE 25.6 and 26.5, macOS)

The headless render engine (`aerendercore -noui`, the process aerender uses) closes by itself once it has nothing to
render. After Effects 2026 can be held up by a file argument it cannot find (it waits on an invisible "file could not be
found" warning), but After Effects 2025 cannot: it quits about 4 s after start whatever it is given. Tried and failed on
2025: missing files of every kind, `-project`, render jobs (the plugin's idle hook never runs during a render), start-up
scripts (they run only as it quits), `-r`/`-s`, `-re`, `-headlessonly`, no `-noui`, Adobe's aerender front end, and
holding it from the plugin's death hook (its effects are already unloaded there). Patching Adobe's
`commandLineRenderer.jsx` is ruled out. The full app stays up in both versions; started hidden and made
background-only by the plugin it shows nothing, and a forced crash showed no crash window. One method for every version.

## Consequences

- A crashing or dialog-raising plugin never reaches the user's session. Remove Grain crashes the headless render engine
  but not the full app; Cineware needs its own layer; six effects that always open dialogs are never probed.
- About 1-2 GB of memory while an engine runs, and a Dock icon for the first few seconds of its start-up.
- Hiding relies on the plugin setting the process background-only once it loads; a release of After Effects that
  undoes it would show a Dock icon or window, never a dialog the user must answer (the guard cancels those).
- Windows: the engine runs `AfterFX.exe -m -noui` with `EXTYNT_ENGINE=1` in its environment (measured on After Effects 2025 and
  2026). A script argument (`-s`) ends a `-noui` instance as soon as the script returns, and a bare marker argument is imported
  as a file, so no marker rides on the command line; After Effects rewrites it to `-m` anyway. The engine is told apart by the pid
  its plugin publishes. An After Effects started as administrator hides its command line from the sidecar, so an unreadable
  AfterFX.exe counts as the user's, matched to a version by its window title. `installedEngineHosts` finds installs on Windows: it
  reads the Adobe folder of Program Files and returns each After Effects 2025 or later that has `Support Files\AfterFX.exe`
  (`FIRST_WINDOWS_YEAR` in `apps/sidecar/src/catalogue-engine-process.ts`).

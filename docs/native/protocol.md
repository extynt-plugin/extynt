# Native plugin wire protocol

The single reference that the C++ plugin (`native/extynt-core`) and the TypeScript client (`packages/host-native`, used by `apps/sidecar` and `tools/fake-plugin`) both follow. Where this file and the code disagree, fix the code or amend this file in the same change. The TypeScript types are `packages/host-native/src/protocol.ts` and the narrowers are the `wire-*.ts` modules; the C++ side is `core/request*`, `core/host_call*`, `core/watch*`, `core/executor*` and `transport/`. Background, measurements and the bench ops (`apply_test`, `undo_test`) are in `docs/native/plugin-design.md`.

## 1. Transport and connections

Newline-delimited JSON over TCP on `127.0.0.1`, UTF-8, one JSON object per line, no embedded newlines. The port and token come from the discovery file `native.json` (`plugin-design.md`, "Discovery and security"). Every line the client sends carries `"token"`; a wrong or missing token gets `UNAUTHORIZED`. Request lines are limited to **16 MiB** (`REQUEST_TOO_LARGE`); SVG artwork plans travel in `host_call` arguments.

The sidecar opens three connections. The plugin does not distinguish them by kind; the split is a client convention that exists because a connection blocks until its job has finished.

| Connection | Carries | Why it is separate |
|---|---|---|
| command | one request in flight at a time: `batch`, reads, `host_call`, `watch_state`, `ping` | the plugin does not read the next line of a connection until the job for the previous one is answered |
| control | `ping_direct` only | answered on the socket thread, so it works while the command connection waits on AE |
| watch | one `watch` request, then only event lines | events must never interleave with responses |

Line discriminator: a **response** has `"id"` and `"ok"`; an **event** has `"event"`. A client classifies every line it reads with `parseResponseLine` (`kind: "response" | "event" | "invalid"`) and treats `invalid` as a protocol error on that connection.

## 2. Requests and responses

Request: `{"id": "<text>", "token": "<64 hex>", "op": "<op>", ...params}`. The plugin echoes `id` verbatim (a JSON number is echoed as its text) and `op`.

Success: `{"ok": true, "id", "op", "result": {...}, "timing": {...}}`.
Failure: `{"ok": false, "id", "op", "error": {"code", "message", "aeErr"?}}`. `aeErr` is present only for `HOST_ERROR` (the AEGP error number). An answer to an unparseable line has `id` `""`.

`timing` (milliseconds unless noted): `queuedMs` (enqueue until the idle hook took the job), `walkMs`, `hashMs`, `contentMs` (the part of `hashMs` spent on key, text, marker, path and layer-reference digests), `serializeMs`, `totalMainThreadMs`, `bytes` (size of `result`), `getterCalls`, `dispatchedBy` (`idle` or `socket`). TypeScript: `WireTiming`.

### 2.1 Error codes

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | the token is missing or wrong |
| `BAD_JSON` | the line is not JSON |
| `BAD_REQUEST` | a parameter is missing or invalid; the message names it (`ops[i]` inside a batch) |
| `UNKNOWN_OP` | no such op |
| `REQUEST_TOO_LARGE` | the line exceeds 16 MiB; the refusal echoes the `id` found in the first 256 bytes of the line (plain string or integer, top level), else it carries none |
| `NO_PROJECT` | no project is open |
| `COMP_NOT_FOUND` | the composition id is not a composition |
| `LAYER_NOT_FOUND` | `effect_menus`: the layer id is not a layer of the composition |
| `UNSUPPORTED` | the host cannot answer this op |
| `SUITE_MISSING` | an AEGP suite the op needs did not load |
| `HOST_ERROR` | an AEGP call failed; `aeErr` holds the code |
| `SHUTTING_DOWN` | After Effects is quitting; the request was not run |
| `LIBRARY_NOT_FOUND` | `host_call`: no library manifest was found |
| `LIBRARY_VERSION_INVALID` | `host_call`: the manifest version does not match `^[0-9A-Za-z._+-]{1,64}$` |
| `LIBRARY_LOAD_FAILED` | `host_call`: the library did not load; the message carries the first 3 `aeHostLoadErrors`. The entry did **not** run |
| `ENTRY_NOT_ALLOWED` | `host_call`: `entry` is not in the allowlist |
| `HOST_MODAL_DIALOG` | `host_call`: After Effects has a modal dialog open (a startup report, an alert), so no script can run. Nothing was loaded or run; retry once it is closed. The sidecar keeps asking for the census every few seconds and treats the write as not started |
| `SCRIPT_ENGINE_NOT_READY` | `host_call`: ExtendScript has no global `JSON` and the library's own `json.jsx` (which the guard loads whenever `JSON` is missing: After Effects defines none itself) did not load either, so no entry can run. Nothing was loaded or run; retry shortly. The sidecar retries it with a short backoff and treats the write as not started |
| `SCRIPT_FAILED` | `host_call`: `AEGP_ExecuteScript` returned an error. For a mutation entry the sidecar treats the outcome as unknown |
| `INTERNAL` | an unexpected plugin failure |

TypeScript: `WIRE_ERROR_CODES`, `WireError` (its `code` is a plain `string`, so a newer plugin never breaks an older client).

## 3. Ops

Main-thread ops run in AE's idle hook. `ping_direct` and the `watch` subscription run on the socket thread.

| op | params | runs | result |
|---|---|---|---|
| `ping` | none | main thread | `{pong, mainThread: true, pluginVersion, aeVersion, host, pid, suites}` (`host`: 3.6) |
| `ping_direct` | none | socket thread | `{pong, mainThread: false, pluginVersion, aeVersion, host, pid, arch, idleAgeMs, idleTicks, queueDepth, oldestQueuedMs, watchers, waitingOnDialog, library: {version, entryFile}}` (3.5) |
| `revision` | none | main thread | `{source: "native", revision (integer or null), revisionUs, floorUs, revisionRaw, error?}` |
| `read_project` | `detail` (`structure` default, or `full`), `hashes`, `maxPropertiesPerLayer`, `maxPropertyDepth`, `preExpression`, `debugFlags` | main thread | the whole project, in the probe's member names (`plugin-design.md`, "Data shape") |
| `read_comp` | `compId`, same options (`detail` defaults to `full`) | main thread | one composition (`COMP_NOT_FOUND`) |
| `read_paths` | `targets: [{compId, layerId, path}]` (1 to 4096) | main thread | `{source, results: [{compId, layerId, path, found, error?, layer?, entry?}], warnings}`; per-target errors `COMP_NOT_FOUND`, `LAYER_NOT_FOUND`, `BAD_PATH`, `PATH_NOT_FOUND`, `NOT_A_PROPERTY` do not fail the response |
| `effect_menus` | `compId`, `layerId` (decimal ids) | main thread; allowed in a batch | `{source, effects: [{matchName, popups: [{matchName, choices, consistent, items}]}]}`: every effect on the layer in effect order (`matchName` is the installed effect's), and for each popup parameter its stream matchName, the host's stated choice count, and the item labels in menu order (1-based in the host; a separator slot is `"-"`, a disabled item loses its leading `(`). `consistent` is false when the split text does not number `choices`. Read-only. Errors `COMP_NOT_FOUND`, `LAYER_NOT_FOUND`, `UNSUPPORTED` |
| `hash_project` | `propertyHashes` | main thread | `{source, algorithm: "xxh3-128", projectHash, itemsHash, compositions, warnings}` |
| `host_call` | `entry`, `args` (3.1) | main thread; allowed in a batch | `HostCallResult` (3.1) |
| `watch_state` | none | main thread; allowed in a batch | the `change` event body without `event`, `seq` or `reason` (4.1) |
| `watch` | `intervalMs` (50 to 2000, default 100), `stillMs` (250 to 10000, default 1000) | socket thread subscribes; the connection becomes event-only | `{subscribed: true, intervalMs, stillMs}`, then event lines (4) |
| `batch` | `ops: [{op, id?, ...params}]` (1 to 64), `stopOnError` (default false) | main thread, **one idle turn** | `BatchResult` (3.2) |

`ping_direct` and `watch` are refused inside a `batch` (`BAD_REQUEST`), and `batch` cannot nest. The test ops `apply_test` and `undo_test` stay in the plugin; nothing in the sidecar uses them and they are not in the TypeScript types.

Reads never write. `read_*` results carry `source: "native"`, `project: {name, filePath, dirty}`, `selectedLayerIds`, `compositions`, `warnings` (and, for `read_project`, `itemCount`, `activeCompositionId`, `currentTime`, `items`, `sources`, and `itemsHash` and `projectHash` with `hashes`). `{"unsupported": "<type>"}` stands for a value the plugin does not read (text documents, markers, mask and shape paths, arbitrary data); those, and `keyDigest`, come from `aeReadPropertyDetails` (3.1). TypeScript: `NativeReadResult` (nested rows are typed by the snapshot adapter).

### 3.1 `host_call`

Runs one allowlisted entry point of the host jsx library through `AEGP_ExecuteScript`. **No request text ever becomes script text.** Parameters:

- `entry`: one of the allowlist below, otherwise `ENTRY_NOT_ALLOWED`.
- `args`: **a string holding the JSON text of an object** (for example `"{\"planId\":\"p1\"}"`), not a JSON object. The plugin passes the caller's bytes through unchanged (re-serialising would push numbers through its own formatter), checks that the text parses to an object (`BAD_REQUEST` otherwise), and emits it only through `escapeJsString` (`\`, `"`, control characters and U+2028/U+2029 escaped). The client sends `JSON.stringify(args)`.

Result: `{source: "native", entry, result, scriptUs, scriptError?, libraryLoaded, libraryLoadUs, libraryVersion, projectEpoch}`.

- `result` is the **string** the entry returned (the jsx returns JSON text; the caller parses it).
- `scriptUs` and `libraryLoadUs` are microseconds inside the two `ExecuteScript` calls. `libraryLoaded` is true when this call loaded the library (false when it was already resident).
- `projectEpoch` is the plugin's epoch (4.2) at the time of the call.
- `scriptError` is the first script error text when the script ran but reported one.
- `optionsDialogScan` (only on `aeHostCensus`, optional): `[{matchName, hasOptionsDialog}]`, one entry per installed effect whose PiPL the plugin read. `hasOptionsDialog` is bit 5 (`PF_OutFlag_I_DO_DIALOG`) of the PiPL `AE_Effect_Global_OutFlags` ('eGLO'), keyed by the PiPL match name ('eMNA'). The plugin scans the Plug-ins folder next to the application and Adobe's Common Plug-ins folder on a background thread after load, so the member is **absent until the scan finished** (and for a host whose plug-in folders cannot be read). Absence means unknown; an effect with no entry was not scanned (for example an effect built into the application on Windows, or a Mac bundle whose PiPL is in its executable's resource fork) and is also unknown, never false. A consumer sets `hasOptionsDialog` on its inventory item only from an entry (`withOptionsDialogFlags` in `packages/host-native`).
- `optionsDialogScanPending` (only on `aeHostCensus`, optional): `true` while that scan is still running, so the census was answered without it; the sidecar asks the census once more about 30 seconds later. Absent means the scan finished, failed, or the host has none.

**Allowlist** (`HOST_ENTRIES`; a fixed table in `core/host_entries.{h,cpp}`):

| Class | Entries |
|---|---|
| mutation (`HOST_MUTATION_ENTRIES`) | `aeApplyPlan`, `aeUndoPlan`, `aePreviewControlValues`, `aeCollectBlurControl`, `aeCollectEffectCreation` |
| read or side file | `aeCaptureFrame`, `aeDiscardCaptureFrame`, `aeHostCensus`, `aeCatalogueProbePage`, `aeCatalogueReadInstance`, `aeCollectIndexPage`, `aeCollectDetailPage`, `aeCollectValuePage`, `aeReadPropertyDetails` |

The plugin does not distinguish the classes; **the sidecar** does (`isMutationEntry`): a mutation entry runs under the mutation lease, and a lost reply on one means the outcome is unknown. All five collection entries, including `aeCollectBlurControl` and `aeCollectEffectCreation`, which write scratch state, run under the **read lease bound to the collection ticket**. A mutation reserve would invalidate the collection job, and the `nativeBridge` receiver refuses a mutation reserve that carries a ticket. `aePreviewControlValues` takes the mutation lease.

**Library guard and load** (one `ExecuteScript`, timed as `libraryLoadUs`). `<v>` is the validated manifest version and `<p>` is the escaped entry path and `<j>` the escaped path of `json.jsx` beside it. Everything is at the top level of the script, never inside a function (`$.evalFile` inside a function keeps the declarations local):

```
if (typeof JSON !== "object") { try { $.evalFile(File("<j>")); } catch (jsonLoadError) {} }
if (typeof JSON !== "object") { __extyntHostLibraryState = "not-ready"; }
else if (typeof __extyntHostLibrary !== "string" || __extyntHostLibrary !== "<v>") {
  __extyntHostLibraryState = "loading";
  try { $.evalFile(File("<p>"));
        __extyntHostLibraryState = (typeof aeHostLoadErrors === "object" && aeHostLoadErrors.length === 0)
          ? "loaded" : "ERR:" + aeHostLoadErrors.slice(0, 3).join(" | "); }
  catch (e) { __extyntHostLibraryState = "ERR:" + String(e); }
  if (__extyntHostLibraryState === "loaded") __extyntHostLibrary = "<v>";
} else { __extyntHostLibraryState = "resident"; }
__extyntHostLibraryState;
```

`probe.jsx` re-declares `var aeHostLoadErrors = []`, so every reload starts clean. A partial load is never marked resident, so the next call retries and reports again. The entry script runs only when the guard returned `loaded` or `resident`; `not-ready` (no JSON even after `json.jsx`) fails it with `SCRIPT_ENGINE_NOT_READY`; anything else with `LIBRARY_LOAD_FAILED`.

**Entry** (second `ExecuteScript`, timed as `scriptUs`). Entry functions take a JSON string, as `aeUndoPlan(raw)` does:

```
__extyntProjectEpoch = <int>; <entry>("<escapeJsString(args)>");
```

`aeCollectionStamp` prefers `__extyntProjectEpoch`, so native events, collection pages and apply stamps agree.

**Library manifest.** The plugin finds the library through `manifest.json` with `{"schema": "extynt-host-library/1", "version": "<v>", "entry": "probe.jsx"}`; `entry` must be relative and contain no `..`. Release builds read only the root-owned system library: `/Library/Application Support/extynt/host/manifest.json` on macOS, `%PROGRAMDATA%\extynt\host\manifest.json` on Windows. Builds configured with `EXTYNT_DEV_LIBRARY=ON` also search the `host` folder of the per-user state directory (`~/Library/Application Support/extynt` on macOS, `%LOCALAPPDATA%\extynt` on Windows). The first candidate whose manifest parses wins; none gives `LIBRARY_NOT_FOUND`. `LibraryEntry` (`core/host_reader.h`) carries `entryFile`, `extensionDir`, `note` and `version`.

### 3.2 `batch`

Several main-thread ops in one idle turn. Result `{source: "native", results: [{op, id?, ok, result | error, mainThreadMs, getterCalls}], ran, failed, requested, totalMainThreadMs}`. An op's failure is reported in its entry and the rest still run unless `stopOnError`. Each op starts from a clean cache, exactly as if sent alone, so a read after a `host_call` sees what the script changed (apply, then verify, in the same turn). Allowed inside: `ping`, `revision`, `read_project`, `read_comp`, `read_paths`, `effect_menus`, `hash_project`, `host_call`, `watch_state`. The envelope's `timing.getterCalls` is the sum. TypeScript: `BatchRequest`, `BatchEntry`, `BatchItem`, `BatchResult`.

### 3.3 `watch_state`

Same body as a `change` event (4.1) without `event`, `seq` or `reason`, sampled in the batch's turn so it stamps the reads that follow it. With no project open it answers an empty state (`projectName: ""`, every other nullable member `null`, empty `selection`) rather than `NO_PROJECT`, so a client can see a project close.

### 3.4 `watch`

Subscribes the connection to events. The response is `{subscribed: true, intervalMs, stillMs}`; from then on the plugin writes only event lines and discards any bytes the client sends, noting only a hangup. The first sample after subscribing always produces a full `change` with `reason: ["initial"]`. Out-of-range values are `BAD_REQUEST`.

### 3.5 `ping_direct`

Answered on the socket thread with no main-thread hop.

| member | meaning |
|---|---|
| `idleAgeMs` | milliseconds since the idle hook last ran, or `null` before its first tick |
| `idleTicks` | idle hook runs since load |
| `queueDepth` | jobs waiting for the main thread |
| `oldestQueuedMs` | age of the oldest waiting job, or `null` when none waits |
| `watchers` | live watch subscriptions |
| `waitingOnDialog` | `{title, sinceMs}` while a `host_call` or `batch` is running on the main thread and a modal After Effects window is open in the AE process, else `null`. `title` is the window's own title, `sinceMs` how long the plugin has seen that window (the clock restarts if the title changes or the window goes away and another appears). Detected on the socket thread from the window system (Windows: the process's enabled top-level windows whose owner is disabled; macOS: the Core Graphics window list for the process at the modal-panel level), never through AppKit or the SDK. Plugins that predate the member omit it, which clients read as `null`. |
| `arch` | `arm64` or `x86_64` |
| `library` | `{version, entryFile}` of the last library resolution (`null` members before the first `host_call`) |

A client treats `idleAgeMs` above 1500 as **AE is busy** (a dialog or popup holds the main loop), a ping not answered within 1 s as **plugin unresponsive**, and otherwise a slow call as **slow** (`StallReport.verdict`). A non-null `waitingOnDialog` is **AE is busy** whatever `idleAgeMs` says, and the UI says `After Effects is waiting for you in the “<title>” window`.

### 3.6 `host` (in `ping` and `ping_direct`)

Which After Effects the plugin loaded into. One binary serves 25.x and 26.x; the difference is a typed field, never a guess. A plugin that omits `host` is answered by the client deriving one from `aeVersion` (`source: "derived"`).

| member | meaning |
|---|---|
| `version`, `major`, `minor`, `patch`, `build` | parsed from the host's version text; `known: false` members are 0 or empty when the text held no `major.minor` |
| `family` | closed vocabulary: `unknown`, `older` (below 25), `ae25`, `ae26`, `newer` |
| `supported` | false only for `older` |
| `experimental` | true only for `newer` (a release above the newest measured major, e.g. AE 27): supported and unmeasured, and labelled EXPERIMENTAL in the panel, `ae_status`, the agent briefing and apply receipts |
| `measured` | true only for a major whose behaviour was measured on a real host (26; 25 once the AE 25 pass has run); a receipt from an unmeasured host says so |
| `aegpApi` | a string `"<major>.<minor>"`: the AEGP API version passed to the entry point |
| `capabilities.svgImport` | `native` (at or above `kNativeSvgMinMajor`, 26 until the AE 25 run decides), `converter` (below it), `unknown` |
| `capabilities.expressionText` | `utf16` or `utf8`, per the Stream suite acquired |
| `capabilities.revisionGuard` | `on` (the plugin reads `app.project.revision`) or `off` (it leaves the revision out of every stamp, `revision` answers null with an `error`, and the sidecar guards by content fingerprint alone). Set per release in `core/host_version.cpp` (`kRevisionGuardMinMajor`, currently 25) |
| `capabilities.suitesComplete` | every suite the reads need loaded |
| `capabilities.streamSuite` | the Stream suite version acquired |

The shared test vectors are `native/extynt-core/tests/vectors/host_versions.json`; the C++ and TypeScript implementations are both held to them.

## 4. Events

Written only on watch connections:

```json
{"event":"change","seq":17,"at":123456.7,"epoch":2,"revision":9264,"items":135,
 "projectName":"CLAUDE_TEST.aep","projectPath":"/Users/x/DEMO/CLAUDE_TEST.aep",
 "activeCompId":"229","activeCompName":"BAKERY","time":6.625,
 "selection":["362"],"selectedLayers":[{"id":"362","index":4,"name":"WOODEN_CRATE"}],
 "reason":["revision","selection"]}
{"event":"still","seq":18,"at":124456.9,"epoch":2,"revision":9264}
{"event":"overflow","dropped":12}
{"event":"host-closing","seq":19,"at":125000.0,"reason":"death-hook"}
```

| event | meaning |
|---|---|
| `change` | something differs from the previous sample; `reason` lists what |
| `still` | nothing changed for `stillMs`; proof that the idle hook is alive and the sidecar's stamp is current |
| `overflow` | this subscriber's queue (256 lines) overflowed and `dropped` older lines were discarded; the client must do a full read |
| `host-closing` | After Effects is quitting (death hook); the plugin closes the socket right after. The sidecar stays up and reports `HOST_OFFLINE` |

### 4.1 Fields

- `seq` increases by one per `change`, `still` and `host-closing` line a subscriber is sent, across kinds. `at` is milliseconds on the plugin's steady clock (relative ordering only).
- `reason` is a subset of `project | revision | active | selection | time | initial`.
- Bounds match `aeCollectionFocus`: `selection` has at most 256 ids; `selectedLayers` has at most 64 entries and names are cut to 128 bytes.
- `items` is recounted only when the revision moved. `revision`, `items`, `projectPath`, `activeCompId`, `activeCompName` and `time` are `null` when unknown; they are always written, and a reader treats an absent one as `null`.
- With no project open: `projectName: ""`, nullable members `null`, `selection: []`.

### 4.2 Epoch

`epoch` increments when `(projectPath, projectName)` changes or the revision decreases. The revision also rises on undo, so a decrease means a different project was opened. `host_call` reports the same epoch as `projectEpoch` even when nobody is watching.

### 4.3 Sampling

The plugin samples every `intervalMs` in the idle hook using only existing reader calls: `project()` for name, path and the active comp id; `openComp(active)` for its name and current time; `selectedLayerIds()` and `layerById` for up to 64 names; and the fixed script `app.project.revision`. A `still` line is due when nothing changed for `stillMs`.

## 5. Lifecycle

- **Load:** the plugin starts its server, writes `native.json`, then runs `launchctl kickstart gui/<uid>/com.extynt.sidecar` (macOS) or `schtasks /Run /TN "extynt sidecar <account>"` (Windows) on a worker thread (no `-k`, so a running sidecar is left alone).
- **Quit:** the death hook publishes `host-closing`, then stops the server, which flushes watch sockets (send timeout 500 ms) so a slow reader cannot hang AE's quit. `kill -9` of AE shows as a connection reset.
- The sidecar reconnects with backoff while `native.json` exists and its pid is alive.

## 6. TypeScript client contract

`packages/host-native` exports the wire types and narrowers (`protocol.ts`, `wire-*.ts`) and the client contract types (`client-types.ts`): `PluginEndpoint`, `CallOptions`, `StallReport`, `CallOutcome`, `PluginClient`, `ConnectOptions`. Behaviour the client guarantees:

- Requests on the command connection are serialised in FIFO order, one in flight.
- A call that has waited `stallAfterMs` (default 2000) sends `ping_direct` on the control connection every second until it settles, and reports the verdict through `onStall`. `StallReport.dialog` is the ping's `waitingOnDialog` (`{title, sinceMs}` or `null`).
- `CallOutcome` is `ok`, `refused` (the plugin answered with an error) or `lost` (`timeout`, `closed`, `protocol`, `shutting-down`). `lost` with `sent: true` on a mutation means the outcome is unknown. Default timeouts: reads 60 s, mutations 900 s.

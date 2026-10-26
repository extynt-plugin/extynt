# Native plugin design

The reference for `native/extynt-core`: the After Effects plugin (AEGP) that reads and verifies the project, runs the host library, watches for changes and docks the panel. The wire format is `docs/native/protocol.md`; the page contract is `docs/native/ui-contract.md`.

## Design principles

- Every operation takes under 1 s end to end, and reads and verifies take about 20 ms. Full-project provenance stays.
- **The plugin is After Effects' hands and eyes.** It does:
  - native reads, hashes and the revision/selection watch;
  - apply (the host library's jsx, run through `AEGP_ExecuteScript`) with a native verify in the same idle turn;
  - undo, frame capture and the census;
  - the dockable panel.

  It makes no decisions.
- **The sidecar is the brain and the memory:** agent, plans, approvals, SQL graph, provenance, staleness and receipts. It also serves the UI.
- macOS and Windows. The core is portable; the panel is WKWebView on macOS and WebView2 on Windows.
- Coding rules apply to every language with no exceptions: `docs/coding-rules.md`, enforced by `pnpm check`.

Why reads are native: a read through the ExtendScript DOM costs about 23 getters per property at an estimated 12 to 20 us each, plus 5 to 17 ms per script hop. The AEGP walk reads the same data in one pass. Measured on macOS with AE 26.2.1 (M4 Pro): a 25-layer comp read takes 29 ms end to end, the whole project 121 ms, an applied edit with its native verify about 30 ms, an undo about 37 ms. What remains is the wait for AE's idle turn (about 33 ms), which batching pays once per request.

## Layout

```
native/extynt-core/
  core/        pure C++17, no SDK, no OS APIs: JSON writer/parser, XXH3-128, path segments,
               request parsing, timing, the walk (walker*.cpp), request executor (incl. batch), 8-bit text
               decoding (text_decode), the DOM rules (layer_rules: camera/light, enabled from raw flags),
               host_call (host_entries allowlist, host_call script building, library_locate manifest),
               host_version (the host profile), watch (sampling and change tracking), the sidecar port
               from session.json (session_port), the panel pages and scripts (panel_page, panel_theme,
               panel_nav, panel_keys_win), write_ops (fixed script templates for the bench ops)
               host_reader.h is the seam: the walk talks to a HostReader, not to AEGP
  transport/   loopback server (net_posix / net_win), token auth, discovery file, event_hub (watch fan-out),
               idle_turn (what one idle-hook call does), launch_agent (starts the sidecar off the main
               thread), library_files (manifest lookup), child_process, per-platform state and library paths
               (no SDK; Linux-testable for the POSIX half)
  ae/          the only code that includes Adobe headers: suites, AeReader (HostReader over AEGP),
               entry point + idle/death hooks, ae_platform_{mac,win}.cpp (host version, paths),
               the panel (ae_panel_view.mm and ae_panel_mac.mm, ae_panel_win*.cpp), PiPL, Info.plist,
               Rez script, windows.cmake
  tests/       unit tests (ctest) with an in-memory fake scene
  third_party/xxhash/   vendored xxhash.h 0.8.3 (BSD-2), unmodified, with its license
  build-mac.sh          configure, build, structural checks, codesign, optional install
  build-win.ps1         configure, build, optional install of the .aex
```

The walk lives in the pure core (behind `HostReader`) rather than in the AE adapter so that path encoding, ordering, kinds, hashing and the request handling are all unit-tested on Linux. The adapter only implements `HostReader` with AEGP calls.

## Threading model

AEGP calls must run on AE's main thread. `AEGP_CauseIdleRoutinesToBeCalled` is the one call documented as safe from another thread, and its suite pointer must be acquired on the main thread.

```
 socket threads (acceptor + one per connection)          AE main thread
 ------------------------------------------------        ---------------------------------
 read line, parse, check token
 ping_direct -> answered here, no main-thread hop
 other ops -> push Job on queue, bump atomic counter
              call saved AEGP_CauseIdleRoutinesToBeCalled  --->  idle hook runs
              wait on the Job's condition variable               if counter == 0: return at once
                                                                  else drain: pop Job, queuedMs =
                                                                  now - enqueued, run executeRequest
                                                                  (all AEGP calls happen here),
              <--- response string, notify  <------------------   finish Job
 write response line
```

- Entry point (`EntryPointFunc`, main thread): acquire suites, save the `CauseIdleRoutinesToBeCalled` function pointer in a global, register the idle hook and the death hook, start the server. It also registers the Window menu item and the panel (see "The panel").
- Idle hook: returns immediately when the queue is empty (one atomic load). Otherwise it runs queued requests until an 8 ms slice has passed (at least one request always runs), then asks AE to call it again if work remains. It also caps `max_sleep` at 30/60 s as a fallback should a wake-up ever be lost. Exceptions never cross into AE.
- Death hook (AE quitting): stop flag first (the idle hook then does nothing), stop the server (queued requests get a `SHUTTING_DOWN` error, sockets close, threads join, the discovery file is removed), release suites, free state.
- One request in flight per connection. Several connections work.

### Dispatch: the idle hook is the only path

A request waits about 30 ms for AE's idle hook (about 30 Hz) before it runs, even though every queued request calls `AEGP_CauseIdleRoutinesToBeCalled`. Nothing shortens it:

| attempt | result (AE 26.2.1, M4 Pro) | decision |
|---|---|---|
| lower `*maxSleepTicks` to 0 or 1 while requests arrive | AE ignores it: `ping` stays 32.8 to 32.9 ms and `queued` p50 about 30.5 ms; no CPU cost either | the hook only caps `maxSleepTicks` at 30 as a fallback |
| run-loop dispatch: `CFRunLoopPerformBlock` on the main loop | the block runs in 0.2 to 0.4 ms and `AEGP_ExecuteScript` works there, but every AEGP project read returns `NO_PROJECT` | rejected: calling suites outside an AE hook is unsupported and gives wrong answers. The idle hook is the only place project reads are valid |
| stability under UI | 300 of 300 requests answered; with a menu open the hook kept running at about 30 ms; with a modal dialog open AE ran it about once a second until the dialog closed; no dialog, hang or crash; the discovery file was removed at both quits | kept as is |

A request therefore costs about 30 ms of queueing plus its own work, so work is **batched into one idle turn**. The `batch` op runs several main-thread ops (reads, a `host_call` and its verify) in one turn and returns per-op results plus the total main-thread time. `timing.dispatchedBy` is `idle` or `socket`.

## Discovery and security

The plugin binds `127.0.0.1` on a kernel-chosen port and writes `native.json` into the per-user state directory: `~/Library/Application Support/extynt` on macOS, `%LOCALAPPDATA%\extynt` on Windows. On macOS the file is mode 0600 in a 0700 directory, written by atomic rename; on Windows the profile folder's default ACL keeps it private to the user and the write is a `MoveFileEx` replace.

```json
{"port": 53211, "token": "<64 hex>", "pid": 4242, "aeVersion": "26.5.0 (build 61)", "pluginVersion": "0.1.0"}
```

It is removed at shutdown only if it still holds this instance's token. After a crash it can be stale; the client checks that `pid` is alive. Every request must carry the token (constant-time compare); a wrong or missing token gets `UNAUTHORIZED`. A startup log is written to `native-core.log` in the same directory (suites acquired, port, errors). With two AE instances the later one owns the discovery file.

The plugin starts the sidecar when it loads, without restarting a running one: `launchctl kickstart gui/<uid>/com.extynt.sidecar` on macOS, `schtasks /Run /TN "extynt sidecar <account>"` on Windows, both on a worker thread.

The host library is found only through a `manifest.json` (schema `extynt-host-library/1`): release builds read the root-owned `/Library/Application Support/extynt/host` on macOS and `%PROGRAMDATA%\extynt\host` on Windows, and nothing else. Builds configured with `EXTYNT_DEV_LIBRARY=ON` also read the user-writable `host` folder in the state directory.

## Protocol

Newline-delimited JSON over TCP, UTF-8, request lines up to 16 MiB. The wire reference (`host_call`, `watch`, `watch_state`, `ping_direct` fields, events, error codes, library manifest, lifecycle) is `docs/native/protocol.md`. The plugin implements it in `core/request*`, `core/host_call*`, `core/watch*`, `core/executor*` and `transport/`. This section records what the reads and the timing mean.

Request: `{"id": "1", "token": "...", "op": "<op>", ...params}`

Response: `{"ok": true, "id": "1", "op": "...", "result": {...}, "timing": {...}}` or `{"ok": false, "id": "1", "op": "...", "error": {"code": "...", "message": "...", "aeErr": 0}}`.

`timing` (milliseconds unless noted):
| field | meaning |
|---|---|
| `queuedMs` | worker enqueue until the idle hook picked the job up (includes AE's idle latency) |
| `walkMs` | host reads plus traversal: total minus serialize minus hash |
| `hashMs` | XXH3-128 work, including the host reads behind the content digests (`contentMs`) |
| `contentMs` | the part of `hashMs` spent folding key, text, marker, path and layer-reference content into row hashes |
| `serializeMs` | JSON writing |
| `totalMainThreadMs` | idle hook dequeue until the result JSON is built |
| `bytes` | size of the `result` member (the timing object itself is excluded) |
| `getterCalls` | AEGP suite calls made for the request (every call, including memory-handle lock/free) |
| `dispatchedBy` | `idle` (the AEGP idle hook) or `socket` (answered on the socket thread: `ping_direct`) |

Serialize and hash are measured with a clock read around each use, which adds roughly 50 ns per property to `totalMainThreadMs`; treat the split as indicative.

Read ops (`read_project`, `read_comp`, `read_paths`, `hash_project`, `revision`) take these options, all in `protocol.md`: `detail` (`structure` or `full`), `hashes`, `maxPropertiesPerLayer`, `maxPropertyDepth`, `preExpression`, `debugFlags`.

`debugFlags: true` makes every property entry carry `dynFlags`, the raw `AEGP_DynStreamFlags` word. It exists so a comparison run can confirm the `enabled` rule and is not part of the probe shape (never use it with `hashes`: the flags change every hash).

`structure` = items, comps, layers with their layer-level members. `full` adds each layer's `propertyPaths`. Nothing is dropped by default: `maxPropertiesPerLayer` (0 = unlimited) and `maxPropertyDepth` (default 64, a safety cap) are only applied when the request sets them, and a hit is reported (`propertyPathsTruncated`, a `warnings` entry).

Two further ops exist for testing the write path on a project copy: `apply_test` (one fixed opacity script inside an undo group, then a native read-back in the same turn) and `undo_test` (`app.executeCommand(16)`, Edit > Undo). The sidecar and the panel do not use them.

## Data shape (mirrors the host library probe)

The `result` of `read_project` corresponds to `envelope.result` of the probe: `items`, `sources`, `compositions[].layers[].propertyPaths[]`. Ids are decimal strings (`String(id)` in the probe). Layer members: `id, index, name, selected, label, type, enabled, shy, solo, locked, threeD, audioEnabled, startTime, inPoint, outPoint, stretch, parentId, matteLayerId, matteType, sourceId, compositionSourceId, switches`. Property entries: `path, matchName, displayName, kind, valueType, value, canSetValue`, and for `kind == "property"`: `expression, expressionEnabled, keyframeCount` (only when above 0), `animatable` (only when false); `hidden` only when true; `enabled` for effects and for direct children of `ADBE Layer Styles`; `dynFlags` only with `debugFlags`.

Path encoding is ported exactly (`core/path_segments.cpp`): a segment is the matchName (display name if empty, `unknown` if both are), with `%` `/` `#` encoded as `%25` `%2F` `%23` in that order; repeated siblings get `#2`, `#3`, ... per group; the layer root lists `ADBE Transform Group` first and everything else in host order. `tests/vectors/path_segments.json` holds the cases; the C++ tests and `tools/native-spike/path-parity.ts` (which evaluates the live function from `host-shared.jsx`) both use it.

How each member is read:

| probe member | native source |
|---|---|
| item id / name / parent | `AEGP_GetItemID`, `AEGP_GetItemName` (Unicode handle), `AEGP_GetItemParentFolder` |
| item list | `AEGP_GetFirstProjItem` / `GetNextProjItem`, skipping the root folder |
| comp fields | `GetItemDimensions`, `GetItemPixelAspectRatio`, `GetItemDuration`, `GetCompFramerate`, `GetCompBGColor`, work area, `GetItemCurrentTime` |
| layer id / index | `AEGP_GetLayerID`; `AEGP_GetLayerIndex` + 1 (AEGP indexes from 0) |
| enabled / shy / solo / locked / threeD / audioEnabled | `AEGP_GetLayerFlags` bits; camera and light layers are then rewritten to the DOM's answer |
| type | `AEGP_GetLayerObjectType` + flags, same precedence as `layerType()` |
| parentId / matteLayerId / sourceId | `AEGP_GetLayerParent` / `AEGP_GetTrackMatteLayer` / `AEGP_GetLayerSourceItem`, then `GetLayerID` / `GetItemID` |
| property walk | `AEGP_DynamicStreamSuite`: `GetNewStreamRefForLayer`, `GetNumStreamsInGroup`, `GetNewStreamRefByIndex`, `GetMatchName`, `GetStreamGroupingType`, `GetDynamicStreamFlags` |
| values | `AEGP_GetNewStreamValue` at the comp's current time, in comp time, after expressions (what ExtendScript `.value` returns); `preExpression:true` samples before them |
| keyframeCount / expression | `AEGP_GetStreamNumKFs`; `AEGP_GetExpressionState` + `AEGP_GetExpression` (UTF-16 on the acquired StreamSuite5; 8-bit UTF-8/Latin-1 if only v9 loads) |
| enabled (effects, layer-style children) | `AEGP_DynStreamFlag_ACTIVE_EYEBALL` and not `AEGP_DynStreamFlag_HIDDEN` (the DISABLED bit never occurs; flags 3 = EYEBALL\|HIDDEN is `false` in the DOM; bit 0x8 is undocumented and ignored). `enabledFromDynFlags` in `core/layer_rules.cpp` |
| hidden | `AEGP_DynStreamFlag_HIDDEN`, plus the probe's rule that an inactive Separate Dimensions follower is hidden (`IsSeparationFollower` / `GetSeparationLeader` / `AreDimensionsSeparated`) |

Value types covered: OneD, TwoD, TwoD_SPATIAL, ThreeD, ThreeD_SPATIAL, Color (`[r,g,b,a]`), and NO_DATA groups (`null`). Arbitrary, marker, text-document, shape-path, layer-id and mask-id values are returned as `{"unsupported": "<type>"}` and are never fetched.

### Rules fixed by comparison with the DOM

- **Effect parameter 0.** AEGP lists an effect's input layer as child 0 (`ADBE Gaussian Blur 2-0000`); the DOM starts at `-0001`. `HostReader::firstChildIndex(group, groupIsEffect)` makes the walker (full walk and `read_paths`) start an effect's children there; the AE adapter returns 1. Paths are `matchName` plus `#n` for repeated siblings, so skipping child 0 shifts nothing else.
- **`enabled` = `ACTIVE_EYEBALL && !HIDDEN`.** Over 1,116 compared entries: flags 9 (EYEBALL plus bit 3: effects such as Slider Control) is `true`; flags 3 (EYEBALL|HIDDEN: `ADBE Layer Styles/ADBE Blend Options Group`) is `false`; flags 10 (HIDDEN plus bit 3: the Layer Styles `.../enabled` children) is `false`. DISABLED (16) never occurs. Bit 3 is not in the SDK header and the rule ignores it. The rule is a fit to the projects compared so far.
- **Camera and light layers** are rewritten to what the DOM reads: `threeD` false; `quality`, `sampling`, `frame-blending`, `blend-mode` null; motion blur, collapse, guide, adjustment, effects-active false. The adapter also stops asking AE for quality, sampling, transfer mode and track matte on those layers. Light layers are reasoned, not confirmed on a real light.
- **Expression text.** The Stream suite is acquired newest-first (v10) so `GetExpression` returns UTF-16. If only v9 loads, the bytes are decoded as UTF-8 with a Latin-1 fallback (`text_decode`).
- **`hidden` and `canSetValue`.** The ExtendScript probe reads `isHidden`, which does not exist in AE 26.2, so its `hidden` only comes from the Separate Dimensions rule. The native values are the accurate side.

Value types covered: OneD, TwoD, TwoD_SPATIAL, ThreeD, ThreeD_SPATIAL, Color (`[r,g,b,a]`), and NO_DATA groups (`null`). Arbitrary, marker, text-document, shape-path, layer-id and mask-id values are returned as `{"unsupported": "<type>"}` and are never fetched; their detail comes from the host library's `aeReadPropertyDetails`. `keyDigest` (the probe's per-key hash) is not emitted by native reads, which give only `keyframeCount`; key content reaches the native hashes through the content digest below, and `keyDigest` comes from `aeReadPropertyDetails`. `sources[].filePath` is not read (it needs the Footage suite), `layer.switches["per-character-3d"]` is null, and blend mode names come from a hand-written table (PF transfer mode to BlendingMode name).

## Merkle hashes

All hashes are XXH3-128 (vendored, BSD-2), written as 32 lowercase hex digits (high 64 bits first). Hashes detect change; they are not cryptographic.

- property hash = H(canonical JSON of the property entry exactly as emitted); for a leaf that is keyed or whose type is text document, marker, shape or mask path, or layer reference, H("content3" || that hash || the host's content digest), see "Content digests" below
- layer hash = H(H(layer head JSON) || property hash 1 || ... || property hash n), digests as 16 big-endian bytes
- comp hash = H(H(comp head JSON) || layer hash 1 || ...)
- project hash = H(items hash || comp hash 1 || ...), where items hash = H(JSON of `items` + `sources`)

### Content digests

The row JSON carries a keyed property's key count and the four value types the detail reads (text document, marker, path, layer reference) only by name, so the walker asks `HostReader::streamContentDigest` for every such leaf while hashing, and only for those: an unkeyed numeric property costs no call. The AE adapter (`ae/ae_reader_digest.cpp`) folds, as plain bytes into a buffered `DigestSink`:

- every key, to the first 1024 (the limit of the jsx key digest): comp time, flags (temporal and spatial continuous and auto-bezier, roving), in and out interpolation, temporal ease (speed and influence, in and out, per temporal dimension), the value, and the spatial tangents of a spatial stream; numeric streams and paths get all of it, text documents and markers only time and value;
- a text document: its UTF-16 text (key values and the value at the current time);
- a marker: comment, chapter, url, frame target and cue point name, duration, label, navigation and protected-region flags;
- a path (mask or shape; key values and the value at the current time): open flag, segment count, and each vertex position with its in and out tangents, to 1001 vertices (the details skip larger paths);
- a layer reference: the layer id and the index it resolves to now.

A field a getter could not read folds as a flag, never as a warning. Not covered: a text document's styling (font, size, fill, stroke, paragraph settings), which the Text Document suite does not expose; the sidecar reuses text layers across equal hashes only at an unchanged project revision. Arbitrary-data streams fold their key times only. The digest time is inside `hashMs` and reported alone as `contentMs`.

`structure` reads hash the layer head only, so a layer hash is comparable only between reads of the same detail. `hash_project` always hashes the full property tree. Changing one property moves that layer, its comp and the project hash and no others (tested).

## Suite versions

Rule: acquire the oldest suite version that has everything the plugin needs, so one binary loads on AE 25.0 and later, and never a version frozen after 25.0. Suite versions are frozen per release; a newer AE still serves older versions. Numbers are the values of the SDK's `kAEGP*SuiteVersion*` macros (what `AcquireSuite` takes), not the struct suffix.

| suite | struct / version | frozen in | why this one |
|---|---|---|---|
| Memory | `AEGP_MemorySuite1` / 1 | AE 5.0 | only version; lock/unlock/free of UTF-16 handles |
| Project | `AEGP_ProjSuite5` / 8 | AE 10.0 | has `GetProjectPath` (Unicode), `ProjectIsDirty`, root folder. v9 (ProjSuite6) only adds bit depth |
| Item | `AEGP_ItemSuite8` / 13 | AE 9.0 | first with a Unicode `GetItemName` (older suites use a 32-char buffer); has `GetItemID`, parent folder, pixel aspect. v14 only changes comment calls |
| Comp | `AEGP_CompSuite4` / 9 | AE 6.5 | first with `GetNewCollectionFromCompSelection` returning the Collection2 type that `CollectionSuite2` reads; has BG color, framerate, work area. `CompSuite13` (v27, AE 26.3) would break AE 25 |
| Layer | `AEGP_LayerSuite9` / 15 | AE 23.0 | the oldest with `GetTrackMatteLayer` (needed for `matteLayerId`); also `GetLayerID`, `GetLayerFromLayerID`, Unicode `GetLayerName` |
| Stream | `AEGP_StreamSuite5` / 10, then 11, then 9 | AE 15 | the oldest with a Unicode `GetExpression`. v9 (Suite4) has the same member list but `GetExpression` returns 8-bit text. v10 and v11 (6 appends `GetUniqueStreamID`) return UTF-16; v9 stays as a last resort and its expression bytes are decoded as UTF-8 with a Latin-1 fallback. `StreamSuite7` (v12) is new in 26.x |
| DynamicStream | `AEGP_DynamicStreamSuite4` / 5 | AE 9.0 | first with the Separate Dimensions calls the probe's hidden rule needs |
| Keyframe | `AEGP_KeyframeSuite4` / 4 | AE 8.0 | the oldest whose key values are `AEGP_StreamValue2` with the marker handle the Marker suite reads; `GetStreamNumKFs`, key time, value, interpolation, temporal ease, spatial tangents and flags feed the content digest. v5 only appends the key label calls |
| TextDocument | `AEGP_TextDocumentSuite1` / 1 | AE 6.0 | only version; `GetNewText` (UTF-16 handle) is hashed as it is. It exposes the text and nothing of the styling |
| Marker | `AEGP_MarkerSuite3` / 3 | AE 16.0 | the first with marker label; strings (comment, chapter, url, frame target, cue point name), duration, label and the navigation and protected-region flags |
| MaskOutline | `AEGP_MaskOutlineSuite3` / 5 | AE 11 | open flag, segment count and every vertex with its tangents, for mask and shape paths |
| Collection | `AEGP_CollectionSuite2` / 2 | AE 6.5 | pairs with CompSuite4's selection collection |
| Utility | `AEGP_UtilitySuite4` / 10, then 11 | AE 7.0 | the oldest with `AEGP_ExecuteScript` (the `revision` op and every `host_call`); v7 (Suite3) has `CauseIdleRoutinesToBeCalled` and the quiet-error calls but not scripting. v11 only appends `UpdateFontList` |
| Register | `AEGP_RegisterSuite5` / 6 | AE 10.0 | only version in the headers; idle and death hooks, and the panel's command, update-menu and create-panel hooks |
| Command | `AEGP_CommandSuite1` / 1 | AE 5.0 | panel: unique command, Window menu item, enable and check mark |
| Workspace Panel | `AEGP_PanelSuite1` / 1 | AE 8.0 | panel: create-panel hook, title, toggle visibility, is-shown |

Text handles (checked against the headers of the versions acquired): project path (`GetProjectPath`, ProjSuite5), item name (`GetItemName`, ItemSuite8), layer and source name (`GetLayerName`, LayerSuite9) and stream name (`GetStreamName`, StreamSuite5) are all `A_UTF16Char` handles. `GetMatchName` is a `char[40]` buffer (UTF-8). The two 8-bit ones are `GetExpression` on StreamSuite4 and the `AEGP_ExecuteScript` result and error handles (read as UTF-8 because the call passes `platform_encodingB = FALSE`).

`ping` reports, for each suite, the version requested and the one acquired, so a failure on a given AE build is visible at once. A missing suite makes every read return `SUITE_MISSING` naming it; ping and the log still work.

## Safety

Reads are read-only by construction: the adapter calls Get/Is/Dispose/Free/Lock/Unlock only: no Set*, no undo group, no UI of its own on the read path. Every stream ref, stream value, collection and memory handle is released on every path (RAII `StreamHandle`; the unit tests assert no stream is left open after a normal read, a failed read, a path read and a write verify). Every AEGP error becomes an error response or a counted warning (`host-read-failed:<call> xN`); nothing throws into AE.

The only route that can change a project is `AEGP_ExecuteScript`, and **no text from a request ever becomes script text**:

- `revision` runs two strings compiled into the plugin (`1`, `app.project.revision`).
- `host_call` runs two scripts built in `core/host_call.cpp`: the library guard (fixed text, with the manifest's validated version and the escaped entry path) and `__extyntProjectEpoch = <int>; <entry>("<escaped args>");`. The entry name comes from the fixed allowlist table in `core/host_entries.cpp`; `args` is the JSON text of an object and reaches the script only through `escapeJsString`. The library is found only through a `manifest.json` (see "Discovery and security"), and the manifest's `entry` is refused when absolute or containing `..`.
- `apply_test` builds its script in `core/write_ops.cpp` from one fixed template; the only variable parts are the comp id and layer id (a JSON integer or a string of at most 15 digits, re-checked as digits when the script is built) and the opacity (a finite number from 0 to 100, rendered by the writer's own number formatter, never a request string). Anything else is `BAD_REQUEST`.
- `undo_test` runs one constant string (`app.executeCommand(16)`).
- Extra members in a request (`script`, `path`, ...) are ignored, never run (unit-tested).

## The panel

The plugin registers the panel as the SDK's Panelator sample does: `AEGP_GetUniqueCommand`, `AEGP_InsertMenuCommand` (Window menu item "extynt", sorted), `AEGP_RegisterCommandHook`, `AEGP_RegisterUpdateMenuHook`, then `AEGP_RegisterCreatePanelHook` with the match name `extynt`. The command calls `AEGP_ToggleVisibility`; the update-menu hook enables and checks the item with `AEGP_IsShown`. The Command and Workspace Panel suites are listed in `ping.suites` but never required for reads (a missing one only disables the panel). The panel suite has no destroy callback, so a panel's end is seen as its web view's `dealloc` (macOS) or its container window being destroyed (Windows).

- **macOS.** The create hook receives an `NSView`; a `WKWebView` is added to it as an autoresizing subview (`ae/ae_panel_view.mm`, `ae_panel_mac.mm`, Objective-C++, ARC, links Cocoa and WebKit). The Cocoa code lives only in the `.mm` files; `core/` and the portable `ae/` files have none.
- **Windows.** The create hook receives the `HWND` of the panel's container; a child host window is made inside it and the WebView2 controller lives in that (`ae/ae_panel_win*.cpp`). WebView2 can only inject a script at document creation, so a script WebKit would inject at document end is wrapped with `runAtDocumentEnd`.
- **Content.** The page is the sidecar UI at `http://127.0.0.1:<port>/ui/`, with the port read from the sidecar's `session.json` (`core/session_port.cpp`; only the port is read, the token is neither kept nor logged). While the sidecar is not reachable the panel shows the built-in offline page ("Starting extynt...", no script, no external resource) and retries by itself. A `panel-url.txt` file in the state directory is a development override (a URL, or `builtin:test` for the built-in key, IME and clipboard test page).
- **What the page gets.** One user script at document start, run only when `location.origin` equals the sidecar origin, defines `window.__extyntNative = {pluginVersion, aeVersion, sidecarOrigin, token, platform, theme}` (`docs/native/ui-contract.md`). The token is the sidecar's bearer. There is no `WKScriptMessageHandler` and no other way for page code to reach the plugin or AEGP; the plugin makes no project writes from the panel. Page script runs in the web content process.
- **Page hardening.** A document-start script makes `alert`, `confirm` and `prompt` return at once, and a document-end script keeps autocorrect, spellcheck, autofill and inline-suggestion popups off every input, textarea and contenteditable (such a popup runs a nested event loop inside After Effects and stalls its idle hook).
- **Flyout.** "Log keys" (default on) and, on macOS, "Reload page"; on Windows also "Key hook". Native-core.log carries the `panel:` lines: create, container, shown/hidden, moved into/out of a window, web view destroyed, page loaded, navigation failures, web content process termination, flyout toggles.

### Keys on macOS

AE takes keys before a web view sees them (Cmd+A selects all layers, arrows and Escape never arrive). One `NSEvent` local monitor is installed at registration (key down, key up, left mouse down). For a key event whose window's first responder is inside one of our web views (a weak table of live views):

- Cmd+C, V, X, A and Cmd+Z / Shift+Cmd+Z: the action (`copy:` ... `undo:` / `redo:`) is sent with `sendAction:to:from:` to the first responder that answers, walking up from the first responder to the web view and no further. If nothing inside answers, the page's `document.execCommand` equivalent runs. The web view's `undoManager` is deliberately not used: it may be the window's, and AE's own undo stack must never be touched. The event is consumed (the monitor returns `nil`).
- Arrows, Home/End/Page keys, Escape, Delete/Backspace, Tab, Return and plain, Option and Shift characters: delivered with `keyDown:` / `keyUp:` straight to the first responder, so text input and IME (marked text, Escape cancelling a composition) work, and consumed. Cmd with an arrow or Backspace is treated the same way.
- Every other Cmd or Ctrl combination (Cmd+S, Cmd+Q, Cmd+W, Ctrl+Cmd+Space, ...): returned unchanged for AE.
- Mouse: a left mouse down that hit-tests inside a web view makes its window key when it is not and can be, and makes the web view first responder when nothing inside it is; the event is returned. `acceptsFirstMouse:` is YES.
- With "Log keys", one `panel key:` line per key event records the key code, modifiers, window and first-responder classes and the route taken (`monitor-action(...)`, `monitor-keydown`, `passed-to-AE`, `not-ours(...)`). A key with no line at all was taken by AE before the monitor.

### Keys on Windows

A key hook (`ae_panel_win_keys.cpp`, rules in `core/panel_keys_win.cpp`) routes shortcuts and arrows to the page while the web view has the keyboard focus. The flyout's "Key hook" item switches it; "Log keys" writes one `panel key:` line per delivered event.

## Known limits

- Values summarized as `{"unsupported": ...}`: arbitrary data, markers, text documents, shape and mask paths, layer-id and mask-id values (the host library supplies the detail).
- A text document's styling (font, size, fill, stroke, paragraph settings) is not covered by the content digest: the Text Document suite does not expose it. The sidecar reuses text layers across equal hashes only at an unchanged project revision.
- One discovery file: with two AE instances the later one wins.
- On Windows a missing WebView2 runtime leaves the panel blank.

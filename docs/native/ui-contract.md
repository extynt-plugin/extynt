# Panel UI contract

How the panel page, the native host and the sidecar fit together. The page is static files served by the sidecar (`apps/sidecar/src/server-ui-static.ts`) from `apps/panel/` (dev) or `<runtime>/ui/` (packaged); its script is `apps/panel/main.js`, built from `apps/panel/runtime/` by `scripts/build-panel.ts`, with `apps/panel/ui-manifest.json` listing every served file and its sha256. Where this file and the code disagree, fix one of them in the same change. The sidecar types are `apps/sidecar/src/ui-contract.ts`; the panel's copy and narrowers are `apps/panel/runtime/ui-contract.ts`.

## 1. What the host gives the page

The native panel (WKWebView, `native/extynt-core/ae/ae_panel_view.mm`) loads `http://127.0.0.1:<port>/ui/` and, through a user script that runs **only when `location.origin` equals the sidecar origin**, defines before any page script:

```
window.__extyntNative = Object.freeze({
  pluginVersion: string,        // the plugin build
  aeVersion: string | null,     // "26.2"
  sidecarOrigin: "http://127.0.0.1:<port>",
  token: string,                // the sidecar bearer, ^[A-Za-z0-9_-]{1,256}$; never logged
  platform: "macos" | "windows", // the host: WKWebView or WebView2; anything else reads as "macos"
  theme: { background: "#rrggbb", luminance: 0..1 } | null,
})
```

The page rejects the object (and behaves as if it were outside the host: no request is sent) when the token is malformed, the origin is not `127.0.0.1`/`localhost` with a port, or it differs from `location.origin`.

Theme: the page sets `data-theme` on `<html>` (`dark` when `luminance < 0.5`, otherwise `light`; no attribute when there is no theme, so `prefers-color-scheme` applies). When AE's brightness changes the host dispatches `window.dispatchEvent(new CustomEvent("extynt-theme", { detail: { background, luminance } }))`; a malformed detail removes the attribute.

Token handling: the page keeps the token in memory only (no storage). Every request carries `Authorization: Bearer <token>`. A 401 means the sidecar restarted with a new token: the page reloads once, and the host injects the fresh token on the new load.

## 2. Static files

`GET /ui/` and `GET /ui/<file>` are unauthenticated: `index.html`, `main.js`, `ui-manifest.json`, `styles/*.css`, `styles/components/*.css`, `fonts/*`, and `gallery.html` and `gallery-icons.js` only in dev (no `uiDirectory` option). The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding). Headers: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-cache`. The runtime therefore sets styles only through the CSSOM (`el.style.x = ...`), never with a `style` attribute, and uses no inline handler.

## 3. Routes (Bearer, same Host check)

| Route | Answer |
|---|---|
| `GET /v1/ui/bootstrap` | `{ok, sidecarVersion, uiBuild, host: HostLinkStatus, hostInstanceId, nativeAccessQuarantine, prefs, currentSessionId, focus: UiFocus\|null, project}` |
| `GET` / `PATCH /v1/ui/prefs` | `{ok, prefs}`; prefs are `{askBeforeApplying: "risky"\|"always"\|"never", suggestPrompts, showThumbnails, rateLimit, diagnostics}` (defaults `risky`, true, true, true, false) |
| `GET /v1/ui/sessions` | `{ok, sessions: [{id, title, project, createdAt, updatedAt, messageCount}], currentSessionId}` |
| `GET` / `PUT` / `DELETE /v1/ui/sessions/:id` | `{ok, session: {id, title, project, createdAt, updatedAt, messages}}` (PUT body `{title, project, createdAt, messages}`) |
| `DELETE /v1/ui/sessions` | clears every chat |
| `PUT /v1/ui/current-session` | body `{id}`; the chat must exist |
| `POST /v1/ui/chat-logs/export` | writes the chat archive to `~/Documents/extynt/Chat Logs/<iso>.jsonl` (under `<stateDirectory>/exports` when a state directory is set), reveals it in Finder, answers `{ok, path, sessions, bytes}`; no file picker |
| `GET /v1/thumbs/:planId` | `{ok, before?, after?}`, each `{dataUrl, width, height}`, from the lane's frame store (`readers.frames.thumbsFor`); 404 `THUMBS_NOT_FOUND` |
| `GET /v1/ui/events` | server-sent events, section 4 |
| `POST /v1/host/read` `{scope:"full"}` | queues a full read and waits up to 15 s: `{ok, refreshed}` |
| `POST /v1/host/census` | `readers.queueCensus()`, then waits up to 30 s for a new inventory: `{ok, read, inventory: {fingerprint, itemCount, truncated}}`; 409 `HOST_OFFLINE` when nothing could be queued; 501 until the lane is bound |
| `POST /v1/host/capture` `{compositionId, time?}` | queues a `capture_frame` item (the agent capture path) and answers `{ok, captureId, dataUrl, width, height, time}`; 409 `NO_COMPOSITION` |
| `POST /v1/variants/:setId/preview` | answers `readers.frames.previewFor(setId)` at once, else queues one `preview_controls` item (command built from the stored set and the latest read) and waits up to 30 s: `{ok, status: "ready"\|"none"\|"unresolved", pictures?, code?}`; `none` when Before/after frames is off; 501 until the lane is bound |

Sessions are bounded: 20 chats (the least recently updated that is not open is evicted), 60 messages each, 512 KiB each, written atomically (temp file, rename, mode 0600) under the profile directory.

## 4. The event stream

`GET /v1/ui/events` is read by the page as a progressive XHR (an `EventSource` cannot send the bearer). Frames are `event: <name>\ndata: <json>\n\n`. It starts with `host`, `focus` and `change`, then sends `host` and `focus` only when they changed, `change` (coalesced to one per 100 ms) on every state change, and `undo`, `thumbs` and `preview` when the hub is published to; a lane focus report only makes every stream re-derive `focus`. A `: keepalive` comment every 15 s, a 5 s re-check, a 10 minute lifetime (the client reconnects at once), at most 8 streams. If the stream drops, the page polls `/v1/ui/bootstrap` once a second until it is back.

| Event | Data |
|---|---|
| `host` | `{host: HostLinkStatus, hostInstanceId, nativeAccessQuarantine}` |
| `focus` | `{focus: {project, compositionId, compositionName, selected, layerNames (<= 8), kinds, selectionFingerprint, at} \| null}` |
| `change` | `{seq, reason, planId?}`: a plan, receipt, snapshot or chat changed; the page re-reads plans and Activity |
| `undo` | `{planId, undo: {available, reason, steps?}}` |
| `thumbs` | `{planId}`: frames for that plan are ready |
| `preview` | `{setId}`: pictures for a variant set are ready; the panel asks the preview route again |

## 5. What the page sends

- Apply, Undo and Discard are tool calls, `POST /v1/mcp/tools/call` with header `X-AE-Client: panel`: `ae_approve_plan {planId, waitSeconds: 20, acknowledgeUnverified?}` (one press; the acknowledgement rides on it when the card says unchecked changes need it), `ae_undo_plan {planId, scope: "all"|"last", waitSeconds: 5}`, `ae_cancel_plan`, `ae_list_plans {limit: 20}`, `ae_get_receipt` (Copy receipt).
- `POST /v1/chat` carries `autoApply: prefs.askBeforeApplying !== "always"`; the real decision is the sidecar's (`autoApplyPolicyOf(uiStoreFor(state).prefs())`, risk tiers).
- `X-AE-Panel-Instance` carries `hostInstanceId` from the bootstrap whenever it is not null.
- A turn binds to the selection at send time: the page records `context: {composition, layers, selected}` on the user message and shows it as a caption; a selection change while the turn runs only marks the chip.

## 6. Connecting the lane

```
const readers = createHostReaders({ state, receivers, sink: uiEventSinkFor(state), thumbsEnabled: thumbsEnabledFor(state) });
bindUiHost(state, readers);          // ui-host.ts: the routes answer from readers.frames and readers.queueCensus
```

Everything else the lane needs from the UI side: `uiStoreFor(state).prefs()` (`autoApplyPolicyOf`) for auto-approve, `uiEventsFor(state).publish({type: "undo", planId, undo})` for live undo, `state.hostLink` and `state.activePanelInstanceId = "native:<pid>:<seq>"` for the banner and the `X-AE-Panel-Instance` header, and `dispatch.notifyChange()` on link status changes.

The lane also guarantees: `ae_approve_plan` from `X-AE-Client: panel` queues to the host lane and waits up to `waitSeconds` exactly as for `agent` (the data carries `status` and `receipt`; `UNVERIFIED_OPERATIONS` stays the refusal when the acknowledgement is missing); `ae_list_plans` rows with `source`; `/v1/changes` entries with `source` (`"panel"` or the agent client name); risk-tiered auto-apply.

The macOS panel (`ae_panel_view.mm`) injects `window.__extyntNative` as in section 1 on every page load and dispatches `extynt-theme` when AE's UI colour changes. AE announces no brightness change to a plugin, so the colour is re-read when a window becomes key or the app becomes active, and on every load.

The Windows panel (`ae_panel_win*.cpp`, WebView2) injects the same object (`platform: "windows"`), and dispatches the same `extynt-theme` event. AE announces no brightness change there either, so the colour is re-read every 3 s while the panel is shown, when its window gets focus and on every load. The Windows panel also owns keyboard routing (Ctrl+A/C/V/X/Z, arrows, Home/End and Escape reach the page and not After Effects); the page needs nothing for it.

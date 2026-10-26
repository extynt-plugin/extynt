# Panel

The extynt panel: a single chat surface served by the sidecar at `http://127.0.0.1:<port>/ui/` and shown in the native plugin's docked WebView (WKWebView on macOS, WebView2 on Windows) (docs/native/ui-contract.md). It talks only to the sidecar; every operation on After Effects is a sidecar API call.

- **Files:** `index.html` and `styles/` (the visual system, docs/design/panel-ui-principles.md), `runtime/` (TypeScript), `main.js` (a build output, git-ignored, bundled from `runtime/` by `scripts/build-panel.ts`; never edit it) and `ui-manifest.json` (also a build output: every served file with its sha256). Run `pnpm build` before serving the panel from a checkout.
- **Start:** the host injects `window.__extyntNative` (token, origin, theme); the page loads `GET /v1/ui/bootstrap`, then its chats from the sidecar store, then follows `GET /v1/ui/events`.
- **Topbar:** the chat title (opens Chats), New chat and Settings. The status bar above the composer is always present and carries everything that needs you (blocked, offline, Apply/Discard/Continue, setup, Stop, time left); pressing it lifts the sheet (Waiting, Now, Needs a look, Checklist, Changes with Undo, Connection).
- **Chat:** `POST /v1/chat`; the live step line shows the sidecar's plain tool labels; each answer has one Details disclosure (reasoning, tools, usage); the composer shows what extynt will act on and each message records the selection it was sent with.
- **Plans:** one card per change, from Ready (rows with before and after values, inline notices, one Apply and Discard) to Done (a verdict line, before and after frames, Undo that follows the sidecar's live undo state).
- **Page:** one full-panel page with a back arrow: Chats, Settings (accordion: About, Provider & keys, Decision model, Approvals, Preferences, Memory, Agents) and Developer (a row in Settings, shown when the Developer page preference is on). The model and effort are picked in the one popover by Send.
- **Tests:** `tests/contract-*.test.ts` run `main.js` in a vm against a stub DOM built from `index.html` and a fake sidecar (`tests/contract.test.ts`); `tests/dom-contract.test.ts` keeps the runtime and the markup/styles in step; `tests/host-*.test.ts` cover the host library.

## Source, bundle and gallery

- `ui-manifest.json` lists every file the sidecar serves under `/ui/` with its sha256, and `scripts/build-panel.ts` regenerates it together with `main.js`. Run `pnpm --filter @extynt/panel build` after changing anything under `runtime/` (the icon table is `runtime/icons.ts`), `styles/` or `index.html`. `gallery-icons.js` is a second build output that hands the icon table to `gallery.html`.
- `gallery.html` is a design review page for developers: every component in both themes at several widths. It is not listed in the manifest and is never served by the sidecar.
- `src/` holds the portable contract files, compiled and tested without After Effects: `contract.ts` (JSON and error envelope and limit logic for host reads) and `diagnostics.ts` (the sanitizer for structured diagnostic events), re-exported by `index.ts`.

## Host library

`apps/panel/host/*.jsx` is not part of the panel. It is the host library: the jsx the native plugin runs inside After Effects through `AEGP_ExecuteScript`, with `probe.jsx` as the entry. The installer places it, with a generated `manifest.json`, where the plugin loads it; `scripts/install-host-library.ts` does the same for a development checkout. Panel code never calls it directly.

## Attribution

`runtime/icons.ts` contains icon geometry derived from the DeepSeek Harness frontend (https://github.com/deepseek-ai/deepseek-harness), used under the MIT license, Copyright (c) DeepSeek. extynt is an independent project and is not affiliated with or endorsed by DeepSeek. The license notice is kept at the top of `runtime/icons.ts`.

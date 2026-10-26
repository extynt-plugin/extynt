// The pages and scripts of the native panel. Portable text only (no SDK, no Cocoa). The built-in test page is plain
// HTML that probes keyboard handling, IME, clipboard and localhost fetch inside AE's process (loaded when panel-url.txt
// says "builtin:test"); it has no way to reach the plugin: no script message handler exists.
#pragma once

#include <optional>
#include <string>
#include <string_view>

#include "panel_theme.h"

namespace extynt::ae {

// The sidecar's port when its session.json cannot be read (apps/sidecar: GET /health on AE_BRIDGE_PORT, default 3210).
constexpr int kFallbackSidecarPort = 3210;

// `createCount` is how many times the native panel has been created in this AE session (shown on the page).
std::string panelTestPageHtml(int createCount);

// `text` as a double-quoted JavaScript string literal that is safe to place in a user script or in an HTML script
// element: quotes, backslashes and control characters are escaped, "<" becomes \u003C (so "</script>" and "<!--" cannot
// appear), U+2028 and U+2029 are escaped, and malformed UTF-8 becomes U+FFFD.
std::string jsStringLiteral(std::string_view text);

// What the native-info script tells the page. `aeVersion` is null in the page when empty, `theme` null when absent.
struct NativeInfo {
  std::string pluginVersion;
  std::string aeVersion;
  // The sidecar's "http://127.0.0.1:<port>"
  std::string origin;
  // Reaches the page only through the script; never logged
  std::string token;
  // "macos" or "windows"
  std::string platform;
  std::optional<HostTheme> theme;
};

// The user script injected at document start into the main frame of every page load. It defines, only when
// location.origin equals `info.origin`:
//   window.__extyntNative = Object.freeze({pluginVersion, aeVersion, sidecarOrigin, token, platform, theme})
// as docs/native/ui-contract.md describes.
std::string panelNativeInfoScript(const NativeInfo& info);

// `source` run once the document has been parsed (DOMContentLoaded), or at once when it already has. WebView2 can only
// inject a script at document creation, so a script WebKit would inject at document end is wrapped with this.
std::string runAtDocumentEnd(const std::string& source);

// Script for a page that is already loaded: dispatches the "extynt-theme" event the page restyles itself on.
std::string panelThemeEventScript(const HostTheme& theme);

// The page shown while the sidecar is not reachable: "Starting extynt..." in the panel's dark and light tokens, no
// script and no external resource. The panel retries the real page by itself. With the host's theme, the page takes
// its background and the matching tokens instead of following the system's colour scheme (on Windows that is the
// Windows app mode, often light under a dark After Effects).
std::string panelOfflinePageHtml(const std::optional<HostTheme>& theme = std::nullopt);

// User script at document end, every frame: keeps WebKit's autocorrect, spellcheck, autofill and inline-suggestion
// popups away (such a popup runs a nested event loop inside After Effects and stalls its idle hook). A
// MutationObserver sets spellcheck=false, autocorrect=off, autocomplete=off, autocapitalize=off and
// writingsuggestions=false on every input, textarea and contenteditable element, present or added later.
std::string panelFieldHardeningScript();

// User script at document start, every frame: alert, confirm and prompt return at once (undefined, false, null), the
// File System Access pickers reject, and a file input never opens a picker. Nothing in the panel may run a modal.
std::string panelDialogShimScript();

}

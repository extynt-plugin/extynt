// Builds the panel's built-in pages, the scripts injected into them and the editing-command strings.

#include "panel_page.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

#include "json_writer.h"
#include "panel_theme.h"

namespace extynt::ae {

namespace {

const char* const kPage = R"HTML(<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>extynt native panel test</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 12px -apple-system, system-ui, sans-serif; margin: 8px; }
  h1 { font-size: 13px; margin: 0 0 6px; }
  fieldset { margin: 0 0 8px; padding: 6px; }
  legend { font-weight: 600; }
  textarea, input[type=text] { width: 100%; box-sizing: border-box; font: inherit; }
  #editable { min-height: 36px; border: 1px solid #888; padding: 4px; }
  #keylog { font: 11px ui-monospace, Menlo, monospace; height: 160px; overflow: auto; border: 1px solid #888; padding: 4px; white-space: pre; }
  button { font: inherit; margin: 2px 4px 2px 0; }
  #keyTable { border-collapse: collapse; width: 100%; }
  #keyTable td { border: 1px solid #8884; padding: 1px 4px; font: 11px ui-monospace, Menlo, monospace; }
  #keyTable td.count { text-align: right; width: 3em; font-weight: 600; }
  #keyTable tr.seen td.count { background: #2a8a2a33; }
  .row { display: flex; gap: 4px; align-items: center; }
  .row input { flex: 1; }
  pre { margin: 4px 0 0; white-space: pre-wrap; word-break: break-all; }
</style></head><body>
<h1>extynt native panel test <span id="state"></span></h1>

<fieldset><legend>Loads</legend>
  native panel creations this session: <b>{{CREATE_COUNT}}</b>;
  page loads (localStorage): <b id="loads">?</b>;
  this document loaded at <span id="loadedAt"></span>
</fieldset>

<fieldset><legend>Native info (window.__extyntNative, injected by the plugin)</legend>
  <pre id="nativeInfo">checking</pre>
</fieldset>

<fieldset><legend>Keys to try (keydowns the page received, per key)</legend>
  <div>Click a text field, press each key once. A count of 0 means the key never reached the page. Do NOT press Cmd+S.</div>
  <table id="keyTable"></table>
  <div id="otherKeys"></div>
  <button id="resetKeys">reset counters</button>
</fieldset>

<fieldset><legend>Text fields</legend>
  <textarea id="area" rows="3" placeholder="textarea"></textarea>
  <input id="line" type="text" placeholder="single-line input">
  <div id="editable" contenteditable="true" spellcheck="false">contenteditable div</div>
</fieldset>

<fieldset><legend>Key log (keydown / keyup / composition / input)</legend>
  <button id="clearLog">clear</button> <span id="focusInfo"></span>
  <div id="keylog"></div>
</fieldset>

<fieldset><legend>Clipboard</legend>
  <button id="clipWrite">write text to clipboard</button>
  <button id="clipRead">read clipboard</button>
  <button id="clipExec">select all in textarea + copy (execCommand)</button>
  <pre id="clipOut">navigator.clipboard: checking</pre>
</fieldset>

<fieldset><legend>Fetch (is localhost allowed from inside AE's process?)</legend>
  <div class="row"><input id="fetchUrl" type="text" value=""><button id="fetchGo">GET</button></div>
  <pre id="fetchOut">no request yet</pre>
</fieldset>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var log = $("keylog"), lines = 0;
  function add(text) {
    var row = document.createElement("div");
    row.textContent = text;
    log.insertBefore(row, log.firstChild);
    if (++lines > 300) { log.removeChild(log.lastChild); lines -= 1; }
  }
  function mods(e) { return (e.metaKey ? "Cmd+" : "") + (e.ctrlKey ? "Ctrl+" : "") + (e.altKey ? "Opt+" : "") + (e.shiftKey ? "Shift+" : "") || "-"; }
  function who(e) { var t = e.target; return t && t.id ? t.id : (t && t.nodeName ? t.nodeName.toLowerCase() : "?"); }
  function keyLine(e) {
    return e.type + " key=" + JSON.stringify(e.key) + " code=" + e.code + " mods=" + mods(e) + " repeat=" + e.repeat + " isComposing=" + e.isComposing + " target=" + who(e);
  }
  window.addEventListener("keydown", function (e) { add(keyLine(e)); }, true);
  window.addEventListener("keyup", function (e) { add(keyLine(e)); }, true);
  ["compositionstart", "compositionupdate", "compositionend"].forEach(function (name) {
    window.addEventListener(name, function (e) { add(name + " data=" + JSON.stringify(e.data) + " target=" + who(e)); }, true);
  });
  window.addEventListener("beforeinput", function (e) { add("beforeinput " + e.inputType + " data=" + JSON.stringify(e.data) + " target=" + who(e)); }, true);
  ["copy", "cut", "paste"].forEach(function (name) {
    window.addEventListener(name, function (e) {
      var text = "";
      try { text = name === "paste" && e.clipboardData ? e.clipboardData.getData("text/plain") : ""; } catch (ignored) {}
      add(name + " event target=" + who(e) + (text ? " text=" + JSON.stringify(text.slice(0, 60)) : ""));
    }, true);
  });
  window.addEventListener("focusin", function (e) { $("focusInfo").textContent = "focus: " + who(e); }, true);
  $("clearLog").addEventListener("click", function () { log.textContent = ""; lines = 0; });


  // ---- native info and the keys-to-try table ----
  var info = window.__extyntNative;
  $("nativeInfo").textContent = info ? JSON.stringify(info) : "window.__extyntNative is not defined (loaded outside the plugin?)";
  var sidecarPort = info && info.sidecarPort ? info.sidecarPort : 3210;
  $("fetchUrl").value = "http://127.0.0.1:" + sidecarPort + "/health";

  var KEYS = [
    ["Left", "plain"], ["Right", "plain"], ["Up", "plain"], ["Down", "plain"], ["Home", "plain"], ["End", "plain"], ["Escape", "plain"],
    ["Backspace", "plain"], ["Delete", "forward delete"], ["Return", "plain"], ["Tab", "plain"], ["Space", "plain"], ["Opt+E", "then E: dead key, e-acute"],
    ["Cmd+A", "select all in the field"], ["Cmd+C", "copy"], ["Cmd+V", "paste"], ["Cmd+X", "cut"], ["Cmd+Z", "undo"], ["Shift+Cmd+Z", "redo"],
    ["Cmd+Left", "line start"], ["Cmd+Backspace", "delete to line start"],
    ["Shift+Cmd+A", "NOT ours: passes to AE (Deselect All); the count must stay 0"]
  ];
  var counts = {}, others = {}, table = $("keyTable");
  KEYS.forEach(function (entry) {
    var row = document.createElement("tr");
    row.id = "key-" + entry[0];
    row.innerHTML = "<td></td><td></td><td class=count>0</td>";
    row.children[0].textContent = entry[0];
    row.children[1].textContent = entry[1];
    table.appendChild(row);
    counts[entry[0]] = 0;
  });
  var NAMES = { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Home: "Home", End: "End", Escape: "Escape", Backspace: "Backspace", Delete: "Delete", Enter: "Return", NumpadEnter: "Return", Tab: "Tab", Space: "Space", PageUp: "PageUp", PageDown: "PageDown" };
  function keyName(e) {
    if (NAMES[e.code]) return NAMES[e.code];
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
    return e.key.length === 1 ? e.key.toUpperCase() : e.key;
  }
  function keyLabel(e) { return (e.shiftKey ? "Shift+" : "") + (e.ctrlKey ? "Ctrl+" : "") + (e.altKey ? "Opt+" : "") + (e.metaKey ? "Cmd+" : "") + keyName(e); }
  function countKey(e) {
    var label = keyLabel(e);
    if (e.key === "Meta" || e.key === "Shift" || e.key === "Control" || e.key === "Alt") return;
    if (Object.prototype.hasOwnProperty.call(counts, label)) {
      counts[label] += 1;
      var row = $("key-" + label); row.className = "seen"; row.children[2].textContent = String(counts[label]);
    } else {
      others[label] = (others[label] || 0) + 1;
      $("otherKeys").textContent = "other keys: " + Object.keys(others).map(function (k) { return k + " x" + others[k]; }).join(", ");
    }
  }
  window.addEventListener("keydown", countKey, true);
  $("resetKeys").addEventListener("click", function () {
    KEYS.forEach(function (entry) { counts[entry[0]] = 0; var row = $("key-" + entry[0]); row.className = ""; row.children[2].textContent = "0"; });
    others = {}; $("otherKeys").textContent = "";
  });

  var loads = "n/a";
  try { loads = String((parseInt(localStorage.getItem("extyntLoads") || "0", 10) || 0) + 1); localStorage.setItem("extyntLoads", loads); } catch (error) { loads = "localStorage unavailable: " + error; }
  $("loads").textContent = loads;
  $("loadedAt").textContent = new Date().toLocaleTimeString();
  $("state").textContent = "(" + location.href.slice(0, 60) + ")";

  var clip = $("clipOut");
  clip.textContent = "navigator.clipboard: " + (navigator.clipboard ? "present" : "absent") + ", isSecureContext=" + window.isSecureContext;
  $("clipWrite").addEventListener("click", function () {
    var text = "extynt clipboard test " + Date.now();
    if (!navigator.clipboard) { clip.textContent = "write: navigator.clipboard absent"; return; }
    navigator.clipboard.writeText(text).then(function () { clip.textContent = "write ok: " + text; }, function (error) { clip.textContent = "write failed: " + error; });
  });
  $("clipRead").addEventListener("click", function () {
    if (!navigator.clipboard) { clip.textContent = "read: navigator.clipboard absent"; return; }
    navigator.clipboard.readText().then(function (text) { clip.textContent = "read ok: " + JSON.stringify(text.slice(0, 200)); }, function (error) { clip.textContent = "read failed: " + error; });
  });
  $("clipExec").addEventListener("click", function () {
    var area = $("area"); area.focus(); area.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (error) { ok = String(error); }
    clip.textContent = "execCommand('copy') returned " + ok;
  });

  $("fetchGo").addEventListener("click", function () {
    var out = $("fetchOut"), url = $("fetchUrl").value, started = Date.now();
    out.textContent = "GET " + url + " ...";
    fetch(url, { cache: "no-store" }).then(function (response) {
      return response.text().then(function (body) {
        out.textContent = "GET " + url + " -> HTTP " + response.status + " in " + (Date.now() - started) + " ms\n" + body.slice(0, 400);
      });
    }, function (error) {
      out.textContent = "GET " + url + " FAILED after " + (Date.now() - started) + " ms: " + (error && error.name) + ": " + (error && error.message);
    });
  });
}());
</script></body></html>
)HTML";

const char* const kOfflinePage = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>extynt</title>
<style>
  :root { color-scheme: dark light; --bg: #16171b; --text: #e9eaef; --muted: #99a0ad; --line: #30343e; --accent: #7c6cf2; }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f5f6f8; --text: #181a1f; --muted: #5d6370; --line: #dde0e6; --accent: #6454e0; }
  }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 13px/1.45 -apple-system, system-ui, sans-serif;
         display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px; box-sizing: border-box; }
  main { max-width: 280px; }
  .mark { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); margin: 0 auto 12px; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
  p { margin: 0; color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 16px auto 0; width: 32px; }
</style></head><body>
<main><div class="mark"></div><h1>Starting extynt&hellip;</h1>
<p>Waiting for the extynt service. This panel retries by itself.</p><hr></main>
</body></html>
)HTML";

const char* const kFieldHardening = R"JS((function () {
  var SELECTOR = 'input, textarea, [contenteditable]';
  var ATTRIBUTES = { spellcheck: 'false', autocorrect: 'off', autocomplete: 'off', autocapitalize: 'off', writingsuggestions: 'false' };
  function harden(element) {
    if (element.getAttribute('contenteditable') === 'false') return;
    Object.keys(ATTRIBUTES).forEach(function (name) {
      if (element.getAttribute(name) !== ATTRIBUTES[name]) element.setAttribute(name, ATTRIBUTES[name]);
    });
  }
  function scan(root) {
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && root.matches(SELECTOR)) harden(root);
    var found = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < found.length; i += 1) harden(found[i]);
  }
  scan(document);
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.type === 'attributes') scan(record.target);
      else for (var i = 0; i < record.addedNodes.length; i += 1) scan(record.addedNodes[i]);
    });
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
}());)JS";

const char* const kDialogShim = R"JS((function () {
  function warn(what) { try { console.warn('extynt panel: ' + what + ' is not available here'); } catch (ignored) {} }
  function define(target, name, value) {
    try { Object.defineProperty(target, name, { value: value, configurable: true, writable: true }); } catch (ignored) {}
  }
  define(window, 'alert', function () { warn('alert'); });
  define(window, 'confirm', function () { warn('confirm'); return false; });
  define(window, 'prompt', function () { warn('prompt'); return null; });
  ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'].forEach(function (name) {
    define(window, name, function () {
      warn(name);
      return Promise.reject(new DOMException('No picker in this panel', 'AbortError'));
    });
  });
  var click = HTMLInputElement.prototype.click;
  define(HTMLInputElement.prototype, 'click', function () {
    if (this.type === 'file') { warn('a file input'); return undefined; }
    return click.apply(this, arguments);
  });
  if (HTMLInputElement.prototype.showPicker) {
    define(HTMLInputElement.prototype, 'showPicker', function () { warn('showPicker'); });
  }
}());)JS";

void replaceAll(std::string& text, const std::string& from, const std::string& to) {
  for (size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size()))
    text.replace(at, from.size(), to);
}

}

std::string panelTestPageHtml(int createCount) {
  std::string page = kPage;
  replaceAll(page, "{{CREATE_COUNT}}", std::to_string(createCount));
  return page;
}

std::string jsStringLiteral(std::string_view text) {
  std::string json;
  appendJsonString(json, text);
  std::string out;
  out.reserve(json.size());
  for (std::size_t i = 0; i < json.size(); ++i) {
    if (json[i] == '<') {
      out += "\\u003C";
    } else if (json.compare(i, 3, "\xE2\x80\xA8") == 0 || json.compare(i, 3, "\xE2\x80\xA9") == 0) {
      out += json[i + 2] == '\xA8' ? "\\u2028" : "\\u2029";
      i += 2;
    } else {
      out += json[i];
    }
  }
  return out;
}

namespace {

std::string themeLiteral(const std::optional<HostTheme>& theme) {
  if (!theme || !std::isfinite(theme->luminance)) return "null";
  return "{background: " + jsStringLiteral(theme->background) + ", luminance: " + formatDouble(theme->luminance) + "}";
}

}

std::string panelNativeInfoScript(const NativeInfo& info) {
  return "if (location.origin === " + jsStringLiteral(info.origin) +
         ") window.__extyntNative = Object.freeze({pluginVersion: " + jsStringLiteral(info.pluginVersion) +
         ", aeVersion: " + (info.aeVersion.empty() ? std::string("null") : jsStringLiteral(info.aeVersion)) +
         ", sidecarOrigin: " + jsStringLiteral(info.origin) + ", token: " + jsStringLiteral(info.token) +
         ", platform: " + jsStringLiteral(info.platform) + ", theme: " + themeLiteral(info.theme) + "});";
}

std::string runAtDocumentEnd(const std::string& source) {
  return "(function () {\nfunction extyntRun() {\n" + source +
         "\n}\nif (document.readyState === \"loading\") document.addEventListener(\"DOMContentLoaded\", extyntRun, "
         "{once: true});\nelse extyntRun();\n})();";
}

std::string panelThemeEventScript(const HostTheme& theme) {
  return "window.dispatchEvent(new CustomEvent(\"extynt-theme\", {detail: " + themeLiteral(theme) + "}));";
}

namespace {

bool hexColour(const std::string& text) {
  return text.size() == 7 && text[0] == '#' &&
         std::all_of(text.begin() + 1, text.end(), [](char c) { return std::isxdigit(static_cast<unsigned char>(c)); });
}

}

std::string panelOfflinePageHtml(const std::optional<HostTheme>& theme) {
  std::string page = kOfflinePage;
  if (!theme || !hexColour(theme->background)) return page;
  const bool dark = theme->luminance < 0.5;
  const std::string pinned = std::string(":root { color-scheme: ") + (dark ? "dark" : "light") +
                             "; --bg: " + theme->background + "; " +
                             (dark ? "--text: #e9eaef; --muted: #99a0ad; --line: #30343e; --accent: #7c6cf2; }"
                                   : "--text: #181a1f; --muted: #5d6370; --line: #dde0e6; --accent: #6454e0; }");
  page.insert(page.find("</style>"), pinned + "\n");
  return page;
}

std::string panelFieldHardeningScript() { return kFieldHardening; }

std::string panelDialogShimScript() { return kDialogShim; }

}

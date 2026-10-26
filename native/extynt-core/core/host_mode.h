// Which kind of After Effects process loaded the plugin. In the catalogue engine (After Effects started hidden with
// `-noui -extynt_engine`) the plugin is the effect catalogue's worker: it publishes native-engine.json instead of
// native.json, and never starts the sidecar.
#pragma once

#include <string>
#include <vector>

#include "request.h"

namespace extynt {

// True only when the command line carries the explicit `-extynt_engine` flag the sidecar's engine launch passes.
// aerendercore or a plain `-noui` After Effects (aerender, a user's batch job) is the user's own session, never the
// catalogue engine, so a user's render cannot be mistaken for it.
[[nodiscard]] bool headlessHost(const std::vector<std::string>& arguments);

// The variable the Windows engine launch sets in the engine's own environment. After Effects on Windows rewrites its
// command line to `AfterFX.exe -m` while it starts, before any plugin loads, so `-extynt_engine` cannot be read there.
inline constexpr const char* kEngineEnvironment = "EXTYNT_ENGINE";

// True only when kEngineEnvironment holds exactly "1": the value the sidecar's launch sets, never an empty or other
// one.
[[nodiscard]] bool engineEnvironment(const std::string& value);

// True when `request` (or a batch item) is a catalogue probe page whose arguments say `"engine":true`, as parsed into
// Request::claimsEngine. Such a probe closes and replaces the untitled project it finds, which is only safe in the
// engine, so a session that is not the engine refuses it.
[[nodiscard]] bool claimsEngineProbe(const Request& request);

// In the headless catalogue engine, which never touches a user project: true for pings, the revision, the project
// watch, Edit > Undo presses and host_call HostCensus, CatalogueProbePage and CatalogueReadInstance, and for a batch
// only when every item qualifies. The engine refuses everything else.
[[nodiscard]] bool engineRequestAllowed(const Request& request);

// The After Effects application bundle that holds `bundlePath`. aerendercore runs from
// ".../Adobe After Effects 2026.app/Contents/aerendercore.app", whose own Info.plist carries a stale version and
// whose folder is not the one with Plug-ins; any other path comes back unchanged.
[[nodiscard]] std::string outerAppBundle(const std::string& bundlePath);

}

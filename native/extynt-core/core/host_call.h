// host_call: one allowlisted entry point of the host jsx library, run through ExecuteScript (docs/native/protocol.md,
// 3.1). Pure core: it talks to a HostReader and builds every script here from fixed text. Nothing from a request
// becomes script text except `args`, and that only through escapeJsString inside a string literal.
#pragma once

#include <cstdint>
#include <string>

#include "direct_status.h"
#include "host_entries.h"
#include "host_reader.h"
#include "request.h"
#include "watch.h"

namespace extynt {

// The guard-and-load script: it loads the library at the top level of the script (a $.evalFile inside a function would
// keep the declarations local) unless the resident copy is already `library.version`. It evaluates to "loaded",
// "resident", "ERR:<text>" or "not-ready" (ExtendScript has no JSON yet, checked in the same script so no extra call
// is made). After Effects defines no global JSON itself, so the guard first loads the library's own json.jsx while it
// is missing. `library.version` must already be valid (isValidLibraryVersion).
std::string buildLibraryGuardScript(const LibraryEntry& library);

// What an entry script is built for: the entry, the project epoch, whether this is the catalogue engine and the stream
// bridge command id (0 when none).
struct EntryCall {
  HostEntry entry = HostEntry::ApplyPlan;
  int64_t epoch = 0;
  bool engine = false;
  int64_t bridgeCommand = 0;
};

// `__extyntProjectEpoch = <epoch>; <entry>("<escaped args>");`, with `__extyntEngineProcess = true;` before the entry
// in the catalogue engine (and never elsewhere), and `__extyntBridgeCommand = <id>;` when the stream bridge command id
// is known (non-zero; the bridge is in no menu, so the jsx cannot look it up). The jsx honours a request's `engine:
// true` only when that marker is set, so a request cannot make a user's session close and replace its project.
std::string buildEntryScript(const EntryCall& call, const std::string& argsJson);

// What a host_call needs from the main thread: the reader, the epoch source and the library status ping_direct reports,
// whether this is the catalogue engine and the stream bridge command id (0 when none).
struct HostCallContext {
  HostReader* host = nullptr;
  WatchTracker* watch = nullptr;
  LibraryStatus* library = nullptr;
  bool engine = false;
  int64_t bridgeCommand = 0;
};

// The response "result" JSON. Throws HostFailure with LIBRARY_NOT_FOUND, LIBRARY_VERSION_INVALID, LIBRARY_LOAD_FAILED,
// SCRIPT_ENGINE_NOT_READY or HOST_MODAL_DIALOG (nothing ran; retry shortly or after the dialog closes) or SCRIPT_FAILED
// (docs/native/protocol.md, 2.1). Failures carry the timing they know (scriptUs, libraryLoaded, libraryLoadUs).
std::string runHostCall(const HostCallContext& context, const Request& request);

}

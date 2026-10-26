// Turns a parsed Request into the response line. Pure core: runs against any HostReader.
#pragma once

#include <string>

#include "direct_status.h"
#include "host_reader.h"
#include "request.h"
#include "timing.h"
#include "watch.h"

namespace extynt {

struct ServerInfo {
  std::string pluginVersion;
  std::string aeVersion;
  int64_t pid = 0;
  // Adapter-supplied: which suites were acquired, at which version
  std::string suitesJson = "{}";
  // "arm64" or "x86_64", reported by ping_direct
  std::string arch;
  // Adapter-supplied `host` object (core/host_version.h), in both pings
  std::string hostJson = "null";
  // The catalogue engine (core/host_mode.h): host_call tells the jsx so
  bool engine = false;
  // The stream bridge command id (0: none); host_call hands it to the jsx
  int64_t bridgeCommand = 0;
};

// What a main-thread request may touch besides the host. The pointers are never null and outlive the call.
struct ExecContext {
  const ServerInfo* info = nullptr;
  // Epoch for host_call, state for watch_state
  WatchTracker* watch = nullptr;
  // What ping_direct reports about the library host_call resolved
  LibraryStatus* library = nullptr;
};

// Runs one request on the calling (main) thread (the idle hook). `queuedMs` is measured by the caller.
// The result is one JSON object (no trailing newline) with ok, id, op, result|error and timing.
std::string executeRequest(const Request& request, HostReader& host, const ExecContext& context, double queuedMs);

// Response for a request that never reached the main thread (bad token, parse error, shutdown).
std::string errorResponse(const std::string& id, const std::string& op, const std::string& code,
                          const std::string& message);

// ping_direct: answered on the socket thread, no main-thread hop.
std::string directPingResponse(const Request& request, const ServerInfo& info, const DirectStatus& status);

// Wraps an already-built `result` JSON object as a successful response answered on the socket thread
// (timing.dispatchedBy is "socket"). Used by ping_direct.
std::string socketResponse(const Request& request, const std::string& resultJson);

}

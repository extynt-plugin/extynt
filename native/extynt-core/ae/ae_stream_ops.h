// Stream operations on one layer: finding the layer a request names and running a list, get or set on a property path.
// Main thread only; each operation opens the streams it needs and disposes them before it returns.
#pragma once

#include <string>

#include "ae_sdk.h"
#include "ae_suites.h"
#include "json_writer.h"
#include "stream_request.h"

namespace extynt::ae {

// The layer a stream request names, or null with `error` set to the reason.
AEGP_LayerH findRequestLayer(const Suites& suites, const StreamRequest& request, std::string& error);

// The layer and plugin identity the stream operations run under.
struct StreamTarget {
  const Suites* suites;
  AEGP_PluginID pluginId;
  AEGP_LayerH layer;
};

// Runs one operation and writes its result object, `{"ok":...}`, to `out`; a failure is reported in the object.
void runStreamOp(const StreamTarget& target, const StreamOp& op, JsonWriter& out);

}

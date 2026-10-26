// The stream bridge: a menu command the host jsx runs mid-script (app.executeCommand) to read and write the hidden
// streams ExtendScript refuses to set, such as the Puppet pin offsets. The jsx writes request.json in the exchange
// folder (transport/exchange_folder.h), runs the command and reads response.json, and what a request may touch is
// decided in core/stream_policy.h. The command runs inside the script's undo group so its writes undo with the plan,
// and only on the main thread.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "ae_sdk.h"
#include "ae_suites.h"

namespace extynt::ae {

// Main thread, from the entry point once the register and utility suites exist. Acquires the Command suite, inserts the
// command "extynt Stream Bridge" (in no menu: the jsx gets its id from the entry script prefix) and registers its
// command hook. Never throws; returns the suite status for the log.
std::vector<SuiteStatus> registerStreamBridge(const SPBasicSuite* basic, AEGP_PluginID pluginId, const Suites& suites);

// The bridge command id, 0 until registered (or when registration failed).
int64_t streamBridgeCommand();

// Main thread, from the death hook.
void releaseStreamBridge(const SPBasicSuite* basic);

// The file the jsx and the plugin exchange requests and answers through (directory only; request.json / response.json
// inside).
std::string streamBridgeDirectory();

}

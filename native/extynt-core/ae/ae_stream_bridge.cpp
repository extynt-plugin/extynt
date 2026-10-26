// The stream bridge: resolves a decoded request's property paths and reads or writes the matched streams.
#include "ae_stream_bridge.h"

#include <exception>
#include <filesystem>
#include <optional>
#include <string>
#include <system_error>
#include <cstdint>
#include <vector>

#include "A.h"
#include "AE_GeneralPlug.h"
#include "SPBasic.h"
#include "SPTypes.h"
#include "ae_hook_adapter.h"
#include "ae_log.h"
#include "ae_quiet_errors.h"
#include "ae_stream_ops.h"
#include "ae_suites.h"
#include "sdk_suite_ids.h"
#include "sdk_suites.h"
#include "exchange_folder.h"
#include "json_writer.h"
#include "stream_policy.h"
#include "stream_request.h"

namespace extynt::ae {

namespace {

constexpr const char* kCommandName = "extynt Stream Bridge";

struct Bridge {
  const AEGP_CommandSuite1* command = nullptr;
  const Suites* suites = nullptr;
  AEGP_PluginID pluginId = 0;
  AEGP_Command menuCommand = 0;
  bool suiteAcquired = false;
  TokenLedger tokens;
};

Bridge& bridge() {
  static Bridge state;
  return state;
}

std::string failure(const std::string& token, const std::string& message) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.fieldBool("ok", false);
  if (!token.empty()) w.field("token", token);
  w.field("error", message);
  w.endObject();
  return text;
}

std::string claimToken(const StreamRequest& request, std::string& error) {
  if (!validBridgeToken(request.token)) {
    error = "the request needs a token of 16 to 64 letters, digits, dots, dashes or underscores";
    return "";
  }
  if (!bridge().tokens.claim(request.token)) {
    error = "that token was already used";
    return "";
  }
  return request.token;
}

std::string runOps(AEGP_LayerH layer, const StreamRequest& request, const std::string& token) {
  const Bridge& state = bridge();
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.fieldBool("ok", true);
  w.field("token", token);
  w.key("results");
  w.beginArray();
  const StreamTarget target{state.suites, state.pluginId, layer};
  for (const StreamOp& op : request.ops) runStreamOp(target, op, w);
  w.endArray();
  w.endObject();
  return text;
}

std::string handle(const Suites& suites, const std::string& requestText) {
  std::string error;
  const std::optional<StreamRequest> request = decodeStreamRequest(requestText, error);
  if (!request) return failure("", "request.json is not valid JSON: " + error);
  const std::string token = claimToken(*request, error);
  if (token.empty()) return failure("", error);
  auto* const layer = findRequestLayer(suites, *request, error);
  if (layer == nullptr) return failure(token, error);
  return runOps(layer, *request, token);
}

std::string answerFor(const Suites& suites, const ExchangeFolder& folder) {
  std::string why;
  const std::string text = folder.takeRequest(kBridgeMaxRequestBytes, why);
  if (text.empty()) return failure("", why);
  try {
    return handle(suites, text);
  } catch (const std::exception& problem) {
    return failure("", std::string("exception in the stream bridge: ") + problem.what());
  } catch (...) {
    return failure("", "unknown exception in the stream bridge");
  }
}

void serveRequest(const Suites& suites) {
  std::string why;
  const std::optional<ExchangeFolder> folder = ExchangeFolder::open(streamBridgeDirectory(), why);
  if (!folder) {
    logLine("stream bridge: " + why);
    return;
  }
  if (!folder->putResponse(answerFor(suites, *folder), why)) logLine("stream bridge: " + why);
}

struct CommandCall {
  AEGP_GlobalRefcon global;
  AEGP_CommandRefcon refcon;
  AEGP_Command command;
  AEGP_HookPriority priority;
  A_Boolean alreadyHandled;
  A_Boolean* handled;
};

void runBridgeCommand(const CommandCall& call) {
  const Bridge& state = bridge();
  if (call.command != state.menuCommand || state.suites == nullptr) return;
  if (call.handled != nullptr) *call.handled = TRUE;
  const QuietErrors quiet(state.suites->utility);
  serveRequest(*state.suites);
}

A_Err updateMenuHook([[maybe_unused]] AEGP_GlobalRefcon global, [[maybe_unused]] AEGP_UpdateMenuRefcon refcon,
                     [[maybe_unused]] AEGP_WindowType window) noexcept {
  try {
    const Bridge& state = bridge();
    if (state.command != nullptr) state.command->AEGP_EnableCommand(state.menuCommand);
  } catch (...) {
    logDroppedException("stream bridge menu update");
  }
  return A_Err_NONE;
}

bool suitesReady(const Suites& s) {
  return s.registrar != nullptr && s.dynamic != nullptr && s.stream != nullptr && s.layer != nullptr &&
         s.project != nullptr && s.item != nullptr && s.comp != nullptr && s.memory != nullptr;
}

A_Err registerCommand(Bridge& state, AEGP_PluginID pluginId, const Suites& suites) {
  A_Err err = state.command->AEGP_GetUniqueCommand(&state.menuCommand);
  if (err == A_Err_NONE) {
    err =
        state.command->AEGP_InsertMenuCommand(state.menuCommand, kCommandName, AEGP_Menu_NONE, AEGP_MENU_INSERT_SORTED);
  }
  if (err == A_Err_NONE) {
    err = suites.registrar->AEGP_RegisterCommandHook(pluginId, AEGP_HP_BeforeAE, state.menuCommand,
                                                     HookAdapter<AEGP_CommandHook>::run<CommandCall, runBridgeCommand>,
                                                     nullptr);
  }
  if (err == A_Err_NONE) err = suites.registrar->AEGP_RegisterUpdateMenuHook(pluginId, updateMenuHook, nullptr);
  if (err == A_Err_NONE) state.command->AEGP_EnableCommand(state.menuCommand);
  return err;
}

}

std::string streamBridgeDirectory() {
  std::error_code ignored;
  return (std::filesystem::temp_directory_path(ignored) / "extynt-stream-bridge").string();
}

int64_t streamBridgeCommand() { return static_cast<int64_t>(bridge().menuCommand); }

std::vector<SuiteStatus> registerStreamBridge(const SPBasicSuite* basic, AEGP_PluginID pluginId, const Suites& suites) {
  std::vector<SuiteStatus> statuses;
  Bridge& state = bridge();
  SuiteStatus status;
  status.key = "streamBridgeCommand";
  status.sdkName = kAEGPCommandSuite;
  status.requested = kAEGPCommandSuiteVersion1;
  try {
    if (acquireSuite(*basic, suite::kCommand, state.command, status.error)) {
      state.suiteAcquired = true;
      status.acquired = kAEGPCommandSuiteVersion1;
    }
    state.suites = &suites;
    state.pluginId = pluginId;
    if (state.command != nullptr && suitesReady(suites)) {
      logLine("stream bridge: command registered, AEGP error " +
              std::to_string(registerCommand(state, pluginId, suites)));
    }
  } catch (...) {
    logDroppedException("stream bridge registration");
  }
  statuses.push_back(status);
  return statuses;
}

void releaseStreamBridge(const SPBasicSuite* basic) {
  Bridge& state = bridge();
  if (basic != nullptr && state.suiteAcquired) basic->ReleaseSuite(kAEGPCommandSuite, kAEGPCommandSuiteVersion1);
  state = Bridge();
}

}

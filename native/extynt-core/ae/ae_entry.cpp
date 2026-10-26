// Plugin entry point and the AEGP hooks: an idle hook (queued requests and the watch stream, transport/idle_turn.h) and
// a death hook, plus the opt-in native-panel experiment (ae_panel.h: a Window menu item and a panel that do nothing
// until the user opens them, with no bridge to the project).
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "A.h"
#include "AE_GeneralPlug.h"
#include "SPBasic.h"
#include "sdk_entry.h"
#include "ae_dialog_probe.h"
#include "ae_log.h"
#include "ae_panel.h"
#include "ae_platform.h"
#include "ae_plugin_layout.h"
#include "ae_reader.h"
#include "ae_stream_bridge.h"
#include "ae_suites.h"
#include "dialog_probe.h"
#include "discovery.h"
#include "executor.h"
#include "host_version.h"
#include "idle_turn.h"
#include "options_dialog_index.h"
#include "plugin_files.h"
#include "server.h"
#include "sidecar_watch.h"
#include "timing.h"
#include "watch.h"

#ifndef EXTYNT_PLUGIN_VERSION
#define EXTYNT_PLUGIN_VERSION "0.0.0-dev"
#endif

namespace {

using namespace extynt;

constexpr A_long kMaxIdleSleepTicks = 30;

struct Plugin {
  const SPBasicSuite* basic = nullptr;
  AEGP_PluginID id = 0;
  ae::Suites suites;
  std::unique_ptr<DialogProbe> dialogProbe;
  std::unique_ptr<OptionsDialogIndex> dialogIndex;
  std::unique_ptr<ae::AeReader> reader;
  std::unique_ptr<Server> server;
  WatchTracker watch;
  std::unique_ptr<IdleTurn> turn;
  std::unique_ptr<SidecarWatch> sidecar;
  ServerInfo info;
  std::vector<ae::SuiteStatus> optionalSuites;
};

using WakeMainThreadFn = A_Err (*)();

struct Globals {
  Plugin* plugin = nullptr;
  std::unique_ptr<Plugin> owned;
  WakeMainThreadFn wakeMainThread = nullptr;
  bool draining = false;
  bool engine = false;
};

Globals& globals() {
  static Globals state;
  return state;
}

void startLog() {
  const std::string directory = ae::stateDirectory();
  if (!directory.empty()) ae::startLogFile(directory + "/native-core.log");
}

void runSlice(Plugin* plugin, SteadyClock::time_point now) {
  Globals& state = globals();
  if (state.draining) return;
  state.draining = true;
  plugin->reader->beginQuietErrors();
  try {
    plugin->turn->work(now);
  } catch (...) {
    ae::logDroppedException("idle slice");
  }
  plugin->reader->endQuietErrors();
  state.draining = false;
}

void capSleep(A_long* maxSleepTicks) {
  if (maxSleepTicks != nullptr && *maxSleepTicks > kMaxIdleSleepTicks) *maxSleepTicks = kMaxIdleSleepTicks;
}

A_Err IdleHook([[maybe_unused]] AEGP_GlobalRefcon globalRefcon, [[maybe_unused]] AEGP_IdleRefcon idleRefcon,
               A_long* maxSleepTicks) noexcept {
  try {
    Plugin* plugin = globals().plugin;
    if (plugin == nullptr || !plugin->server || !plugin->turn) return A_Err_NONE;
    capSleep(maxSleepTicks);
    plugin->turn->noteTick();
    if (globals().engine) ae::keepEngineOutOfSight();
    const SteadyClock::time_point now = SteadyClock::now();
    if (!plugin->turn->hasWork(now)) return A_Err_NONE;
    runSlice(plugin, now);
  } catch (...) {
    ae::logDroppedException("idle hook");
  }
  return A_Err_NONE;
}

A_Err DeathHook([[maybe_unused]] AEGP_GlobalRefcon globalRefcon,
                [[maybe_unused]] AEGP_DeathRefcon deathRefcon) noexcept {
  Globals& state = globals();
  Plugin* plugin = state.plugin;
  if (plugin == nullptr) return A_Err_NONE;
  const std::unique_ptr<Plugin> owned = std::move(state.owned);
  try {
    ae::logLine("death hook: stopping server");
    state.plugin = nullptr;
    state.wakeMainThread = nullptr;
    if (plugin->sidecar) plugin->sidecar->stop();
    if (plugin->server) {
      plugin->server->publish(plugin->watch.hostClosingLine(steadyMs(SteadyClock::now())));
      plugin->turn.reset();
      plugin->server->stop();
    }
    plugin->reader.reset();
    plugin->dialogIndex.reset();
    plugin->dialogProbe.reset();
    ae::releaseStreamBridge(plugin->basic);
    ae::releaseNativePanel(plugin->basic);
    ae::releaseSuites(plugin->basic, plugin->suites);
  } catch (...) {
    ae::logDroppedException("death hook");
  }
  return A_Err_NONE;
}

void wakeMainThread() {
  const WakeMainThreadFn cause = globals().wakeMainThread;
  if (cause != nullptr) cause();
}

struct ApiVersion {
  A_long major;
  A_long minor;
};

bool registerHooks(Plugin& plugin) {
  const A_Err idle = plugin.suites.registrar->AEGP_RegisterIdleHook(plugin.id, IdleHook, nullptr);
  const A_Err death = plugin.suites.registrar->AEGP_RegisterDeathHook(plugin.id, DeathHook, nullptr);
  if (idle != A_Err_NONE || death != A_Err_NONE) {
    ae::logLine("hook registration failed: idle=" + std::to_string(idle) + " death=" + std::to_string(death));
    return false;
  }
  return true;
}

HostApiFacts hostApiFacts(const Plugin& plugin, const ApiVersion& api) {
  HostApiFacts facts;
  facts.aegpApiMajor = api.major;
  facts.aegpApiMinor = api.minor;
  facts.streamSuite = plugin.suites.streamVersion;
  facts.expressionUtf16 = plugin.suites.expressionIsUtf16();
  facts.suitesComplete = plugin.suites.firstMissing().empty();
  return facts;
}

void startServer(Plugin& plugin, const ApiVersion& api, bool engine) {
  plugin.info.pluginVersion = EXTYNT_PLUGIN_VERSION;
  plugin.info.engine = engine;
  plugin.info.arch = ae::hostArchitecture();
  plugin.info.aeVersion = ae::hostVersionString();
  plugin.info.suitesJson = ae::suitesJson(plugin.suites, api.major, api.minor, plugin.optionalSuites);
  plugin.info.hostJson = hostProfileJson(plugin.info.aeVersion, hostApiFacts(plugin, api));
  plugin.reader = std::make_unique<ae::AeReader>(plugin.suites, plugin.id);
  plugin.reader->setRevisionGuard(revisionGuardOn(parseHostVersion(plugin.info.aeVersion)));
  plugin.dialogIndex = std::make_unique<OptionsDialogIndex>(makeFilePiplSource(ae::hostPluginLayout()));
  plugin.reader->setOptionsDialogIndex(plugin.dialogIndex.get());
  plugin.dialogProbe = ae::makeDialogProbe();
  ServerConfig config;
  config.dialogProbe = plugin.dialogProbe.get();
  config.engine = engine;
  config.discoveryPath = defaultDiscoveryPath(engine);
  config.info = plugin.info;
  config.wakeMainThread = wakeMainThread;
  plugin.server = std::make_unique<Server>(config);
  std::string error;
  if (!plugin.server->start(error)) {
    ae::logLine("server start failed: " + error);
    plugin.server.reset();
    return;
  }
  plugin.info = plugin.server->info();
  plugin.turn = std::make_unique<IdleTurn>(*plugin.server, *plugin.reader, plugin.watch);
  ae::logLine("server listening on 127.0.0.1:" + std::to_string(plugin.server->port()) + ", discovery file " +
              config.discoveryPath);
  if (engine) return;
  const Server* server = plugin.server.get();
  plugin.sidecar = std::make_unique<SidecarWatch>(
      SidecarWatch::Callbacks{[server] { return server->hasWatchers(); }, ae::startSidecar,
                              [](const std::string& line) { ae::logLine(line); }});
  plugin.sidecar->start();
}

void logSuites(const std::vector<ae::SuiteStatus>& statuses) {
  for (const ae::SuiteStatus& status : statuses) {
    ae::logLine("suite " + status.key + " (" + status.sdkName + "): requested v" + std::to_string(status.requested) +
                ", acquired v" + std::to_string(status.acquired) +
                (status.acquired != 0 ? "" : ", SPErr " + std::to_string(status.error)));
  }
}

bool setUpPlugin(Plugin& plugin, const ApiVersion& api) {
  ae::acquireSuites(plugin.basic, plugin.suites);
  logSuites(plugin.suites.status);
  if (plugin.suites.registrar == nullptr || plugin.suites.utility == nullptr) {
    ae::logLine("register/utility suite missing: cannot hook the idle loop, giving up (plugin stays loaded but inert)");
    ae::releaseSuites(plugin.basic, plugin.suites);
    return false;
  }
  globals().wakeMainThread = plugin.suites.utility->AEGP_CauseIdleRoutinesToBeCalled;
  if (!registerHooks(plugin)) {
    ae::releaseSuites(plugin.basic, plugin.suites);
    return false;
  }
  const bool engine = ae::hostIsHeadless();
  globals().engine = engine;
  if (engine) {
    ae::keepEngineOutOfSight();
    ae::startEngineDialogGuard();
    ae::keepEngineListenersLocal();
  }
  plugin.optionalSuites = ae::registerNativePanel(plugin.basic, plugin.id, plugin.suites.registrar);
  if (!engine) {
    const std::vector<ae::SuiteStatus> bridgeSuites = ae::registerStreamBridge(plugin.basic, plugin.id, plugin.suites);
    plugin.optionalSuites.insert(plugin.optionalSuites.end(), bridgeSuites.begin(), bridgeSuites.end());
    plugin.info.bridgeCommand = ae::streamBridgeCommand();
  }
  logSuites(plugin.optionalSuites);
  if (engine) ae::logLine("engine mode: -extynt_engine; no sidecar start, discovery " + discoveryFileName(true));
  startServer(plugin, api, engine);
  return true;
}

}

namespace extynt::ae {

A_Err initializePlugin(const PluginEntry& entry) noexcept {
  if (entry.refcon != nullptr) *entry.refcon = nullptr;
  Globals& state = globals();
  try {
    std::unique_ptr<Plugin> plugin = std::make_unique<Plugin>();
    plugin->basic = entry.basic;
    plugin->id = entry.pluginId;
    state.plugin = plugin.get();
    startLog();
    ae::logLine(std::string("extynt-core ") + EXTYNT_PLUGIN_VERSION + " loading; AEGP init API " +
                std::to_string(entry.majorVersion) + "." + std::to_string(entry.minorVersion));
    if (setUpPlugin(*plugin, ApiVersion{entry.majorVersion, entry.minorVersion})) {
      state.owned = std::move(plugin);
    } else {
      state.plugin = nullptr;
      state.wakeMainThread = nullptr;
    }
  } catch (...) {
    state.plugin = nullptr;
    state.wakeMainThread = nullptr;
  }
  return A_Err_NONE;
}

}

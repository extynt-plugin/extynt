// Runs a host_call: loads the host jsx library when needed, runs the requested entry and reports the timing.
#include "host_call.h"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "direct_status.h"
#include "host_entries.h"
#include "host_reader.h"
#include "json_writer.h"
#include "library_locate.h"
#include "options_dialogs.h"
#include "request.h"
#include "watch.h"
#include "write_ops.h"

namespace extynt {

namespace {

constexpr size_t kMaxGuardResultText = 600;
constexpr const char* kJsonFile = "json.jsx";

std::string siblingFile(const std::string& entryFile, const std::string& name) {
  const size_t slash = entryFile.find_last_of("/\\");
  return slash == std::string::npos ? name : entryFile.substr(0, slash + 1) + name;
}

struct LibraryReady {
  bool loaded = false;
  double loadUs = 0;
};

LibraryEntry requireLibrary(HostReader& host, LibraryStatus& status) {
  const LibraryEntry library = host.libraryEntry();
  status.set(library.version, library.entryFile);
  if (library.entryFile.empty())
    throw HostFailure("the host library was not found: " + library.note, 0, "LIBRARY_NOT_FOUND");
  if (!isValidLibraryVersion(library.version))
    throw HostFailure("the library manifest version must match ^[0-9A-Za-z._+-]{1,64}$", 0, "LIBRARY_VERSION_INVALID");
  return library;
}

[[noreturn]] void refuseNotReady(HostReader& host, HostEntry entry, double us) {
  const std::string name(hostEntryName(entry));
  host.note("host_call " + name + " refused: SCRIPT_ENGINE_NOT_READY (JSON is not defined yet)");
  throw HostFailure(name + " was not run: the script engine is not ready (JSON is not defined yet)", 0,
                    "SCRIPT_ENGINE_NOT_READY")
      .withTiming(FailureTiming{us, false, 0});
}

bool refusedForModalDialog(const ScriptRun& run) {
  return run.result.empty() && run.error.rfind(kModalDialogErrorPrefix, 0) == 0;
}

[[noreturn]] void refuseModalDialog(HostReader& host, HostEntry entry, double us) {
  const std::string name(hostEntryName(entry));
  host.note("host_call " + name + " refused: HOST_MODAL_DIALOG (After Effects has a dialog open)");
  throw HostFailure(name + " was not run: After Effects has a dialog open", 0, "HOST_MODAL_DIALOG")
      .withTiming(FailureTiming{us, false, 0});
}

LibraryReady ensureLibrary(HostReader& host, const LibraryEntry& library, HostEntry entry) {
  const ScriptRun guard = host.executeFixedScript(buildLibraryGuardScript(library));
  if (guard.result == "not-ready") refuseNotReady(host, entry, guard.us);
  if (refusedForModalDialog(guard)) refuseModalDialog(host, entry, guard.us);
  if (!guard.error.empty() && guard.result.empty()) {
    throw HostFailure("the library guard script failed: " + guard.error, 0, "LIBRARY_LOAD_FAILED")
        .withTiming(FailureTiming{guard.us, false, 0});
  }
  if (guard.result != "loaded" && guard.result != "resident") {
    const std::string shown = guard.result.substr(0, kMaxGuardResultText);
    throw HostFailure("the host library did not load: " + (shown.empty() ? guard.error : shown), 0,
                      "LIBRARY_LOAD_FAILED")
        .withTiming(FailureTiming{guard.us, false, 0});
  }
  return LibraryReady{guard.result == "loaded", guard.us};
}

struct CallReport {
  ScriptRun run;
  LibraryReady ready;
  std::string libraryVersion;
  int64_t epoch = 0;
  std::optional<std::vector<EffectDialogFlag>> dialogFlags;
  bool dialogScanPending = false;
};

void writeDialogFlags(JsonWriter& w, const std::vector<EffectDialogFlag>& flags) {
  w.key("optionsDialogScan");
  w.beginArray();
  for (const EffectDialogFlag& flag : flags) {
    w.beginObject();
    w.field("matchName", flag.matchName);
    w.fieldBool("hasOptionsDialog", flag.hasOptionsDialog);
    w.endObject();
  }
  w.endArray();
}

std::string hostCallResult(const Request& request, const CallReport& report) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("source", "native");
  w.field("entry", hostEntryName(request.entry));
  w.field("result", report.run.result);
  w.fieldNum("scriptUs", report.run.us);
  if (!report.run.error.empty()) w.field("scriptError", report.run.error);
  w.fieldBool("libraryLoaded", report.ready.loaded);
  w.fieldNum("libraryLoadUs", report.ready.loadUs);
  w.field("libraryVersion", report.libraryVersion);
  w.fieldInt("projectEpoch", report.epoch);
  if (report.dialogFlags) writeDialogFlags(w, *report.dialogFlags);
  if (report.dialogScanPending) w.fieldBool("optionsDialogScanPending", true);
  w.endObject();
  return text;
}

}

std::string buildLibraryGuardScript(const LibraryEntry& library) {
  const std::string& version = library.version;
  return R"(if (typeof JSON !== "object") { try { $.evalFile(File(")" +
         escapeJsString(siblingFile(library.entryFile, kJsonFile)) +
         R"(")); } catch (jsonLoadError) {} }
if (typeof JSON !== "object") { __extyntHostLibraryState = "not-ready"; }
else if (typeof __extyntHostLibrary !== "string" || __extyntHostLibrary !== ")" +
         version + R"(") {
  __extyntHostLibraryState = "loading";
  try { $.evalFile(File(")" +
         escapeJsString(library.entryFile) +
         R"("));
        __extyntHostLibraryState = (typeof aeHostLoadErrors === "object" && aeHostLoadErrors.length === 0)
          ? "loaded" : "ERR:" + aeHostLoadErrors.slice(0, 3).join(" | "); }
  catch (e) { __extyntHostLibraryState = "ERR:" + String(e); }
  if (__extyntHostLibraryState === "loaded") __extyntHostLibrary = ")" +
         version + R"(";
} else { __extyntHostLibraryState = "resident"; }
__extyntHostLibraryState;)";
}

std::string buildEntryScript(const EntryCall& call, const std::string& argsJson) {
  std::string marker = call.engine ? "__extyntEngineProcess = true; " : "";
  if (call.bridgeCommand > 0) marker += "__extyntBridgeCommand = " + std::to_string(call.bridgeCommand) + "; ";
  return "__extyntProjectEpoch = " + std::to_string(call.epoch) + "; " + marker +
         std::string(hostEntryName(call.entry)) + "(\"" + escapeJsString(argsJson) + "\");";
}

std::string runHostCall(const HostCallContext& context, const Request& request) {
  HostReader& host = *context.host;
  const LibraryEntry library = requireLibrary(host, *context.library);
  const LibraryReady ready = ensureLibrary(host, library, request.entry);
  CallReport report;
  report.ready = ready;
  report.libraryVersion = library.version;
  report.epoch = context.watch->probeEpoch(host);
  const EntryCall call{request.entry, report.epoch, context.engine, context.bridgeCommand};
  report.run = host.executeFixedScript(buildEntryScript(call, request.argsJson));
  if (request.entry == HostEntry::HostCensus) {
    report.dialogFlags = host.effectDialogFlags();
    report.dialogScanPending = !report.dialogFlags && host.effectDialogScanPending();
  }
  host.invalidateCaches();
  if (refusedForModalDialog(report.run)) refuseModalDialog(host, request.entry, report.run.us);
  if (report.run.result.empty() && !report.run.error.empty()) {
    const std::string name(hostEntryName(request.entry));
    host.note("host_call " + name + " failed: " + report.run.error.substr(0, kMaxGuardResultText));
    throw HostFailure(name + " failed: " + report.run.error, 0, "SCRIPT_FAILED")
        .withTiming(FailureTiming{report.run.us, ready.loaded, ready.loadUs});
  }
  return hostCallResult(request, report);
}

}

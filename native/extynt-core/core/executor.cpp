// Runs a parsed request, or a batch of them in one idle turn, against a HostReader and writes the response line with
// its timing.

#include "executor.h"

#include <cstdint>
#include <algorithm>
#include <exception>
#include <optional>
#include <string>

#include "dialog_probe.h"
#include "direct_status.h"
#include "effect_menus.h"
#include "host_call.h"
#include "json_writer.h"
#include "host_reader.h"
#include "request.h"
#include "timing.h"
#include "walker.h"
#include "write_ops.h"

namespace extynt {

namespace {

void writeEnvelopeHead(JsonWriter& w, const std::string& id, const std::string& op, bool ok) {
  w.beginObject();
  w.fieldBool("ok", ok);
  w.field("id", id);
  w.field("op", op);
}

void writeOptionalNumber(JsonWriter& w, const char* name, const std::optional<double>& value) {
  if (value) w.fieldNum(name, *value);
  else w.fieldNull(name);
}

void writeDialog(JsonWriter& w, const std::optional<DialogReport>& dialog) {
  w.key("waitingOnDialog");
  if (!dialog) {
    w.null();
    return;
  }
  w.beginObject();
  w.field("title", dialog->title);
  w.fieldNum("sinceMs", dialog->sinceMs);
  w.endObject();
}

void writeDirectFields(JsonWriter& w, const ServerInfo& info, const DirectStatus& status) {
  w.field("arch", info.arch);
  writeOptionalNumber(w, "idleAgeMs", status.idleAgeMs);
  w.fieldInt("idleTicks", static_cast<int64_t>(status.idleTicks));
  w.fieldInt("queueDepth", static_cast<int64_t>(status.queueDepth));
  writeOptionalNumber(w, "oldestQueuedMs", status.oldestQueuedMs);
  w.fieldInt("watchers", status.watchers);
  writeDialog(w, status.dialog);
  w.key("library");
  w.beginObject();
  if (status.library.version.empty()) w.fieldNull("version");
  else w.field("version", status.library.version);
  if (status.library.entryFile.empty()) w.fieldNull("entryFile");
  else w.field("entryFile", status.library.entryFile);
  w.endObject();
}

std::string pingResult(const ServerInfo& info, const DirectStatus* direct) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.fieldBool("pong", true);
  w.fieldBool("mainThread", direct == nullptr);
  w.field("pluginVersion", info.pluginVersion);
  w.field("aeVersion", info.aeVersion);
  w.fieldInt("pid", info.pid);
  w.key("host");
  w.raw(info.hostJson);
  if (direct == nullptr) {
    w.key("suites");
    w.raw(info.suitesJson);
  } else {
    writeDirectFields(w, info, *direct);
  }
  w.endObject();
  return text;
}

ScriptRevision revisionOf(HostReader& host) {
  if (host.revisionGuard()) return host.scriptRevision();
  ScriptRevision off;
  off.error = "revision guard is off for this After Effects version";
  return off;
}

std::string revisionResult(const ScriptRevision& cost) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("source", "native");
  if (cost.revision) w.fieldInt("revision", *cost.revision);
  else w.fieldNull("revision");
  w.fieldNum("revisionUs", cost.revisionUs);
  w.fieldNum("floorUs", cost.floorUs);
  w.field("revisionRaw", cost.revisionRaw);
  if (!cost.error.empty()) w.field("error", cost.error);
  w.endObject();
  return text;
}

std::string runOp(const Request& request, HostReader& host, const ExecContext& context, Timing& timing);

void writeFailure(JsonWriter& w, const HostFailure& failure) {
  w.key("error");
  w.beginObject();
  w.field("code", failure.code());
  w.field("message", failure.what());
  if (failure.hostCode() != 0) w.fieldInt("aeErr", failure.hostCode());
  if (failure.timing()) {
    w.fieldNum("scriptUs", failure.timing()->scriptUs);
    w.fieldBool("libraryLoaded", failure.timing()->libraryLoaded);
    w.fieldNum("libraryLoadUs", failure.timing()->libraryLoadUs);
  }
  w.endObject();
}

struct BatchEntry {
  std::string json;
  bool ok = false;
};

BatchEntry runBatchOp(const Request& op, HostReader& host, const ExecContext& context, Timing& total) {
  BatchEntry entry;
  Timing timing;
  const SteadyClock::time_point start = SteadyClock::now();
  JsonWriter w(entry.json);
  w.beginObject();
  w.field("op", op.opName);
  if (!op.id.empty()) w.field("id", op.id);
  try {
    host.beginRequest();
    const std::string result = runOp(op, host, context, timing);
    entry.ok = true;
    w.fieldBool("ok", true);
    w.key("result");
    w.raw(result);
  } catch (const HostFailure& failure) {
    w.fieldBool("ok", false);
    writeFailure(w, failure);
  } catch (const std::exception& failure) {
    w.fieldBool("ok", false);
    w.key("error");
    w.beginObject();
    w.field("code", "INTERNAL");
    w.field("message", failure.what());
    w.endObject();
  }
  timing.getterCalls = host.getterCalls();
  w.fieldNum("mainThreadMs", elapsedMs(start, SteadyClock::now()));
  w.fieldInt("getterCalls", static_cast<int64_t>(timing.getterCalls));
  w.endObject();
  total.getterCalls += timing.getterCalls;
  total.serializeMs += timing.serializeMs;
  total.hashMs += timing.hashMs;
  total.contentMs += timing.contentMs;
  return entry;
}

std::string runBatch(const Request& request, HostReader& host, const ExecContext& context, Timing& timing) {
  const SteadyClock::time_point start = SteadyClock::now();
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("source", "native");
  w.key("results");
  w.beginArray();
  int64_t ran = 0;
  int64_t failed = 0;
  for (const Request& op : request.batch) {
    const BatchEntry entry = runBatchOp(op, host, context, timing);
    w.raw(entry.json);
    ++ran;
    if (!entry.ok) {
      ++failed;
      if (request.stopOnError) break;
    }
  }
  w.endArray();
  w.fieldInt("ran", ran);
  w.fieldInt("failed", failed);
  w.fieldInt("requested", static_cast<int64_t>(request.batch.size()));
  w.fieldNum("totalMainThreadMs", elapsedMs(start, SteadyClock::now()));
  w.endObject();
  return text;
}

std::string runWalkerOp(const Request& request, HostReader& host, Timing& timing) {
  WalkOptions options;
  options.detail = request.detail;
  options.maxPropertiesPerLayer = request.maxPropertiesPerLayer;
  options.maxPropertyDepth = request.maxPropertyDepth;
  options.preExpression = request.preExpression;
  options.hashes = request.hashes;
  options.propertyHashes = request.propertyHashes;
  options.debugFlags = request.debugFlags;
  Walker walker(host, options);
  std::string result;
  switch (request.op) {
    case Op::ReadProject: result = walker.readProject(); break;
    case Op::ReadComp: result = walker.readComp(request.compId); break;
    case Op::ReadPaths: result = walker.readPaths(request.targets); break;
    case Op::HashProject: result = walker.hashProject(); break;
    default: throw HostFailure("op not handled on the main thread", 0, "UNKNOWN_OP");
  }
  timing.serializeMs = static_cast<double>(walker.serializeNs()) / 1e6;
  timing.hashMs = static_cast<double>(walker.hashNs()) / 1e6;
  timing.contentMs = static_cast<double>(walker.contentNs()) / 1e6;
  return result;
}

std::string runHostOp(const Request& request, HostReader& host, const ExecContext& context, Timing& timing) {
  if (request.op == Op::HostCall) {
    const HostCallContext call{&host, context.watch, context.library, context.info->engine,
                               context.info->bridgeCommand};
    return runHostCall(call, request);
  }
  if (request.op == Op::ApplyTest) return runApplyTest(host, request);
  if (request.op == Op::UndoTest) return runUndoTest(host, request);
  if (request.op == Op::EffectMenus) return runEffectMenus(host, request);
  return runWalkerOp(request, host, timing);
}

std::string runOp(const Request& request, HostReader& host, const ExecContext& context, Timing& timing) {
  if (request.op == Op::Ping) return pingResult(*context.info, nullptr);
  if (request.op == Op::Revision) return revisionResult(revisionOf(host));
  if (request.op == Op::Batch) return runBatch(request, host, context, timing);
  if (request.op == Op::WatchState) return context.watch->stateJson(context.watch->take(host));
  return runHostOp(request, host, context, timing);
}

std::string finish(const Request& request, const std::string& result, Timing& timing) {
  timing.bytes = result.size();
  std::string out;
  out.reserve(result.size() + 256);
  JsonWriter w(out);
  writeEnvelopeHead(w, request.id, request.opName, true);
  w.key("result");
  w.raw(result);
  w.key("timing");
  timing.write(w);
  w.endObject();
  return out;
}

}

std::string errorResponse(const std::string& id, const std::string& op, const std::string& code,
                          const std::string& message) {
  std::string out;
  JsonWriter w(out);
  writeEnvelopeHead(w, id, op, false);
  w.key("error");
  w.beginObject();
  w.field("code", code);
  w.field("message", message);
  w.endObject();
  w.endObject();
  return out;
}

std::string directPingResponse(const Request& request, const ServerInfo& info, const DirectStatus& status) {
  return socketResponse(request, pingResult(info, &status));
}

std::string socketResponse(const Request& request, const std::string& resultJson) {
  Timing timing;
  timing.dispatchedBy = "socket";
  return finish(request, resultJson, timing);
}

std::string executeRequest(const Request& request, HostReader& host, const ExecContext& context, double queuedMs) {
  Timing timing;
  timing.queuedMs = queuedMs;
  const SteadyClock::time_point start = SteadyClock::now();
  try {
    host.beginRequest();
    const std::string result = runOp(request, host, context, timing);
    timing.totalMainThreadMs = elapsedMs(start, SteadyClock::now());
    if (request.op != Op::Batch) timing.getterCalls = host.getterCalls();
    timing.walkMs = timing.totalMainThreadMs - timing.serializeMs - timing.hashMs;
    timing.walkMs = std::max<double>(timing.walkMs, 0);
    return finish(request, result, timing);
  } catch (const HostFailure& failure) {
    std::string out;
    JsonWriter w(out);
    writeEnvelopeHead(w, request.id, request.opName, false);
    writeFailure(w, failure);
    w.endObject();
    return out;
  } catch (const std::exception& failure) {
    return errorResponse(request.id, request.opName, "INTERNAL", failure.what());
  } catch (...) {
    return errorResponse(request.id, request.opName, "INTERNAL", "unknown exception");
  }
}

}

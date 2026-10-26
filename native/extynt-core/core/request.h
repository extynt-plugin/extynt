// Request parsing for the newline-delimited JSON protocol (docs/native/plugin-design.md): one line becomes a Request
// with every member typed, or a refusal with the protocol's error code.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "host_entries.h"

namespace extynt {

enum class Op : uint8_t {
  Ping,
  PingDirect,
  ReadProject,
  ReadComp,
  ReadPaths,
  HashProject,
  Revision,
  Batch,
  ApplyTest,
  UndoTest,
  HostCall,
  Watch,
  WatchState,
  EffectMenus,
};
enum class Detail : uint8_t { Structure, Full };

constexpr int kWatchIntervalMinMs = 50;
constexpr int kWatchIntervalMaxMs = 2000;
constexpr int kWatchIntervalDefaultMs = 100;
constexpr int kWatchStillMinMs = 250;
constexpr int kWatchStillMaxMs = 10000;
constexpr int kWatchStillDefaultMs = 1000;

struct PathTarget {
  std::string compId;
  std::string layerId;
  std::string path;
};

// One parsed request; only the members its op reads are meaningful. `id` is echoed verbatim (a JSON string, or a number
// rendered as text). maxPropertiesPerLayer 0 means unlimited: nothing is dropped. The write-prototype ops (ApplyTest,
// UndoTest) carry decimal ids already validated as digits, never script text; hasLayerTarget says an UndoTest was given
// both ids, so the opacity is read back. A Batch holds its ops in `batch`. A HostCall holds an allowlist member and
// `argsJson`, the JSON text of an object that only ever reaches a script through escapeJsString; claimsEngine says a
// catalogue probe's arguments carry `"engine":true`.
struct Request {
  std::string id;
  std::string token;
  std::string opName;
  Op op = Op::Ping;
  Detail detail = Detail::Full;
  std::string compId;
  std::vector<PathTarget> targets;
  int64_t maxPropertiesPerLayer = 0;
  int maxPropertyDepth = 64;
  bool preExpression = false;
  bool hashes = false;
  bool propertyHashes = false;
  bool debugFlags = false;
  std::string layerId;
  bool hasLayerTarget = false;
  double opacity = 0;
  std::vector<Request> batch;
  bool stopOnError = false;
  HostEntry entry = HostEntry::ApplyPlan;
  std::string argsJson;
  bool claimsEngine = false;
  int watchIntervalMs = kWatchIntervalDefaultMs;
  int watchStillMs = kWatchStillDefaultMs;
};

struct ParsedRequest {
  bool ok = false;
  std::string errorCode;
  std::string errorMessage;
  Request request;
};

constexpr size_t kMaxRequestBytes = size_t{16} << 20;
constexpr size_t kMaxTargets = 4096;
constexpr size_t kMaxBatchOps = 64;

// Parses one request line. On any refusal `ok` is false and the code and message are the protocol's; the id and op name
// read before the refusal are kept so the response can echo them.
ParsedRequest parseRequest(std::string_view line);

}

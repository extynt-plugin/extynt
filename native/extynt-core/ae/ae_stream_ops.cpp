// Stream operations on one layer: resolves a request's property path and lists, reads or writes the matched streams.
#include "ae_stream_ops.h"

#include <array>
#include <cstddef>
#include <string>
#include <variant>
#include <vector>

#include "A.h"
#include "AE_GeneralPlug.h"
#include "SPTypes.h"
#include "ae_suites.h"
#include "json_writer.h"
#include "sdk_memory.h"
#include "stream_policy.h"
#include "stream_request.h"

namespace extynt::ae {

namespace {

constexpr size_t kMaxListChildren = 512;
constexpr size_t kMaxNameChars = 200;

struct Streams {
  const Suites& s;
  AEGP_PluginID id;
  AEGP_LayerH layer;
  std::vector<AEGP_StreamRefH> opened;
  Streams(const Suites& suites, AEGP_PluginID pluginId, AEGP_LayerH layerH) : s(suites), id(pluginId), layer(layerH) {}
  ~Streams() {
    for (AEGP_StreamRefH ref : opened) s.stream->AEGP_DisposeStream(ref);
  }
  Streams(const Streams&) = delete;
  Streams& operator=(const Streams&) = delete;
  Streams(Streams&&) = delete;
  Streams& operator=(Streams&&) = delete;
};

AEGP_ItemH findItem(const Suites& s, A_long wantedId) {
  AEGP_ProjectH project = nullptr;
  if (s.project->AEGP_GetProjectByIndex(0, &project) != A_Err_NONE || project == nullptr) return nullptr;
  AEGP_ItemH item = nullptr;
  if (s.item->AEGP_GetFirstProjItem(project, &item) != A_Err_NONE) return nullptr;
  while (item != nullptr) {
    A_long id = 0;
    if (s.item->AEGP_GetItemID(item, &id) == A_Err_NONE && id == wantedId) return item;
    AEGP_ItemH next = nullptr;
    if (s.item->AEGP_GetNextProjItem(project, item, &next) != A_Err_NONE) return nullptr;
    item = next;
  }
  return nullptr;
}

AEGP_StreamRefH childOf(Streams& streams, AEGP_StreamRefH current, const PathSegment& segment) {
  AEGP_StreamRefH next = nullptr;
  A_Err err = A_Err_GENERIC;
  if (const auto* match = std::get_if<MatchSegment>(&segment)) {
    err = streams.s.dynamic->AEGP_GetNewStreamRefByMatchname(streams.id, current, match->name.c_str(), &next);
  } else if (const auto* index = std::get_if<IndexSegment>(&segment)) {
    err = streams.s.dynamic->AEGP_GetNewStreamRefByIndex(streams.id, current, static_cast<A_long>(index->index), &next);
  }
  if (err != A_Err_NONE || next == nullptr) return nullptr;
  streams.opened.push_back(next);
  return next;
}

AEGP_StreamRefH resolve(Streams& streams, const std::vector<PathSegment>& path, std::string& error) {
  AEGP_StreamRefH current = nullptr;
  if (streams.s.dynamic->AEGP_GetNewStreamRefForLayer(streams.id, streams.layer, &current) != A_Err_NONE ||
      current == nullptr) {
    error = "the layer has no stream root";
    return nullptr;
  }
  streams.opened.push_back(current);
  for (const PathSegment& segment : path) {
    current = childOf(streams, current, segment);
    if (current == nullptr) {
      error = "no stream for a path segment";
      return nullptr;
    }
  }
  return current;
}

std::string matchNameOf(const Suites& s, AEGP_StreamRefH stream) {
  std::array<char, AEGP_MAX_STREAM_MATCH_NAME_SIZE> match{};
  s.dynamic->AEGP_GetMatchName(stream, match.data());
  return {match.data()};
}

void writeValue(JsonWriter& w, const char* name, AEGP_StreamType type, const AEGP_StreamVal2& value) {
  w.key(name);
  switch (type) {
    case AEGP_StreamType_OneD: w.num(value.one_d); break;
    case AEGP_StreamType_TwoD:
    case AEGP_StreamType_TwoD_SPATIAL:
      w.beginArray();
      w.num(value.two_d.x);
      w.num(value.two_d.y);
      w.endArray();
      break;
    case AEGP_StreamType_ThreeD:
    case AEGP_StreamType_ThreeD_SPATIAL:
      w.beginArray();
      w.num(value.three_d.x);
      w.num(value.three_d.y);
      w.num(value.three_d.z);
      w.endArray();
      break;
    default: w.null(); break;
  }
}

bool dimensionsOf(AEGP_StreamType type, size_t& count) {
  switch (type) {
    case AEGP_StreamType_OneD: count = 1; return true;
    case AEGP_StreamType_TwoD:
    case AEGP_StreamType_TwoD_SPATIAL: count = 2; return true;
    case AEGP_StreamType_ThreeD:
    case AEGP_StreamType_ThreeD_SPATIAL: count = 3; return true;
    default: return false;
  }
}

const char* dimensionName(size_t dims) {
  constexpr std::array<const char*, 3> kNames = {"OneD", "TwoD", "ThreeD"};
  return kNames.at(dims - 1);
}

void assignValue(AEGP_StreamType type, const std::vector<double>& numbers, AEGP_StreamVal2& value) {
  switch (type) {
    case AEGP_StreamType_OneD: value.one_d = numbers.at(0); break;
    case AEGP_StreamType_TwoD:
    case AEGP_StreamType_TwoD_SPATIAL:
      value.two_d.x = numbers.at(0);
      value.two_d.y = numbers.at(1);
      break;
    default:
      value.three_d.x = numbers.at(0);
      value.three_d.y = numbers.at(1);
      value.three_d.z = numbers.at(2);
      break;
  }
}

struct ValueSlot {
  AEGP_StreamRefH stream;
  AEGP_StreamType type;
  A_Time time;
  size_t dims;
  AEGP_StreamValue2 value;
};

bool readValue(Streams& streams, const ValueSlot& slot, AEGP_StreamValue2& value) {
  const A_Time time = slot.time;
  return streams.s.stream->AEGP_GetNewStreamValue(streams.id, slot.stream, AEGP_LTimeMode_CompTime, &time, FALSE,
                                                  &value) == A_Err_NONE;
}

bool writeAndReadBack(Streams& streams, ValueSlot& slot, JsonWriter& w) {
  const Suites& s = streams.s;
  if (s.stream->AEGP_SetStreamValue(streams.id, slot.stream, &slot.value) != A_Err_NONE) return false;
  AEGP_StreamValue2 after{};
  if (readValue(streams, slot, after)) {
    writeValue(w, "written", slot.type, after.val);
    s.stream->AEGP_DisposeStreamValue(&after);
  }
  return true;
}

struct ValueJob {
  AEGP_StreamRefH stream;
  const std::vector<double>* set;
  bool vertexIndex;
};

std::string applyValue(Streams& streams, const ValueJob& job, ValueSlot& current, JsonWriter& w) {
  if (job.set == nullptr) return "";
  if (job.set->size() != current.dims || !settableValuesInRange(*job.set, job.vertexIndex)) {
    return "value must be " + std::to_string(current.dims) + " finite number(s) within the allowed range";
  }
  assignValue(current.type, *job.set, current.value.val);
  return writeAndReadBack(streams, current, w) ? "" : "AEGP_SetStreamValue failed";
}

bool runValue(Streams& streams, const ValueJob& job, JsonWriter& w, std::string& error) {
  ValueSlot current{job.stream, AEGP_StreamType_NO_DATA, A_Time{0, 1}, 0, {}};
  if (streams.s.stream->AEGP_GetStreamType(job.stream, &current.type) != A_Err_NONE ||
      !dimensionsOf(current.type, current.dims)) {
    error = "the stream is not a number or a vector";
    return false;
  }
  if (!readValue(streams, current, current.value)) {
    error = "AEGP_GetNewStreamValue failed";
    return false;
  }
  w.field("type", dimensionName(current.dims));
  writeValue(w, "value", current.type, current.value.val);
  error = applyValue(streams, job, current, w);
  streams.s.stream->AEGP_DisposeStreamValue(&current.value);
  return error.empty();
}

std::string streamNameOf(const Suites& s, AEGP_PluginID id, AEGP_StreamRefH stream) {
  std::string name;
  AEGP_MemHandle nameHandle = nullptr;
  if (s.stream->AEGP_GetStreamName(id, stream, FALSE, &nameHandle) != A_Err_NONE || nameHandle == nullptr) return name;
  MemoryLock locked(*s.memory, nameHandle);
  if (locked.lockError() == A_Err_NONE && locked.locked()) {
    for (const A_u_short* wide = locked.units(); *wide != 0 && name.size() < kMaxNameChars; ++wide) {
      name.push_back(*wide < 128 ? static_cast<char>(*wide) : '?');
    }
    static_cast<void>(locked.unlock());
  }
  s.memory->AEGP_FreeMemHandle(nameHandle);
  return name;
}

void runList(Streams& streams, AEGP_StreamRefH stream, JsonWriter& w) {
  const Suites& s = streams.s;
  A_long count = 0;
  s.dynamic->AEGP_GetNumStreamsInGroup(stream, &count);
  w.key("children");
  w.beginArray();
  for (A_long i = 0; i < count && static_cast<size_t>(i) < kMaxListChildren; ++i) {
    AEGP_StreamRefH child = nullptr;
    if (s.dynamic->AEGP_GetNewStreamRefByIndex(streams.id, stream, i, &child) != A_Err_NONE || child == nullptr) {
      continue;
    }
    streams.opened.push_back(child);
    w.beginObject();
    w.fieldInt("index", i);
    w.field("match", matchNameOf(s, child));
    w.field("name", streamNameOf(s, streams.id, child));
    w.endObject();
  }
  w.endArray();
}

struct OpPlan {
  const StreamOp* op = nullptr;
  std::string verb;
  const std::vector<PathSegment>* path = nullptr;
  std::string leaf;
  AEGP_StreamRefH stream = nullptr;
};

bool effectIsPuppet(Streams& streams, const std::vector<PathSegment>& path) {
  const std::vector<PathSegment> prefix(path.begin(), path.begin() + 2);
  std::string ignored;
  auto* const effect = resolve(streams, prefix, ignored);
  return effect != nullptr && matchNameOf(streams.s, effect) == kPuppetEffectMatch;
}

bool knownVerb(const std::string& verb) { return verb == "list" || verb == "get" || verb == "set"; }

bool planSet(Streams& streams, const std::vector<PathSegment>& path, OpPlan& plan, std::string& error) {
  plan.leaf = settablePinStream(path);
  if (plan.leaf.empty()) {
    error = "set is only allowed on a Puppet pin's Vertex Offset or Vertex Index";
    return false;
  }
  if (!effectIsPuppet(streams, path)) {
    error = "the effect on that path is not Puppet";
    return false;
  }
  return true;
}

bool planOp(Streams& streams, const StreamOp& op, OpPlan& plan, std::string& error) {
  plan.op = &op;
  plan.verb = op.verb;
  if (!op.path) {
    error = "path must be an array of 1 to " + std::to_string(kBridgeMaxPathDepth) + " segments";
    return false;
  }
  plan.path = &*op.path;
  if (!knownVerb(plan.verb)) {
    error = "unknown op";
    return false;
  }
  return plan.verb != "set" || planSet(streams, *plan.path, plan, error);
}

bool execute(Streams& streams, const OpPlan& plan, JsonWriter& w, std::string& error) {
  if (plan.verb == "list") {
    runList(streams, plan.stream, w);
    return true;
  }
  if (plan.verb != "set") return runValue(streams, ValueJob{plan.stream, nullptr, false}, w, error);
  if (matchNameOf(streams.s, plan.stream) != plan.leaf) {
    error = "the stream found is not the pin stream the path names";
    return false;
  }
  return runValue(streams,
                  ValueJob{plan.stream, plan.op->value ? &*plan.op->value : nullptr, plan.leaf == kPinIndexMatch}, w,
                  error);
}

}

AEGP_LayerH findRequestLayer(const Suites& s, const StreamRequest& request, std::string& error) {
  auto* const item = request.compId ? findItem(s, *request.compId) : nullptr;
  AEGP_CompH comp = nullptr;
  AEGP_LayerH layer = nullptr;
  if (item == nullptr) {
    error = "composition not found";
  } else if (s.comp->AEGP_GetCompFromItem(item, &comp) != A_Err_NONE || comp == nullptr) {
    error = "item is not a composition";
  } else if (!request.layerId ||
             s.layer->AEGP_GetLayerFromLayerID(comp, static_cast<AEGP_LayerIDVal>(*request.layerId), &layer) !=
                 A_Err_NONE ||
             layer == nullptr) {
    error = "layer not found";
    layer = nullptr;
  }
  return layer;
}

void runStreamOp(const StreamTarget& target, const StreamOp& op, JsonWriter& out) {
  Streams streams(*target.suites, target.pluginId, target.layer);
  std::string error;
  OpPlan plan;
  bool ok = planOp(streams, op, plan, error);
  if (ok) plan.stream = resolve(streams, *plan.path, error);
  out.beginObject();
  ok = ok && plan.stream != nullptr && execute(streams, plan, out, error);
  out.fieldBool("ok", ok);
  if (!ok) out.field("error", error);
  out.endObject();
}

}

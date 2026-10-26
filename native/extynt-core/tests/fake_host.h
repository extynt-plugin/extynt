// In-memory HostReader used by the walker tests: a small scene with the shapes the real
// property tree has (indexed groups, repeated siblings, effects, hidden leaves, expressions).
#pragma once

#include <array>
#include <deque>
#include <functional>
#include <map>
#include <set>
#include <utility>

#include "direct_status.h"
#include "executor.h"
#include "host_reader.h"
#include "watch.h"

namespace fake {
struct Node;
struct Layer;
}

namespace extynt {

// The fake scene completes the opaque reference targets: a token names the node or layer a reference stands for.
struct StreamToken {
  fake::Node* node = nullptr;
};

struct LayerToken {
  fake::Layer* layer = nullptr;
};

}

namespace fake {

using namespace extynt;

// What a leaf's detail reads depend on and its row does not carry; the fake folds all of it, the way the AE adapter
// does.
struct FakeKey {
  double time = 0;
  double value = 0;
  int64_t interpolation = 0;
  std::array<double, 4> ease = {0, 0, 0, 0};
};

struct FakeMarker {
  double time = 0;
  std::string comment;
  double duration = 0;
  bool protectedRegion = false;
};

struct FakeVertex {
  double x = 0;
  double y = 0;
  double inX = 0;
  double inY = 0;
  double outX = 0;
  double outY = 0;
};

struct Content {
  std::vector<FakeKey> keys;
  std::string text;
  std::vector<FakeMarker> markers;
  std::vector<FakeVertex> path;
  bool closed = true;
  int64_t layerRef = 0;
};

struct Node {
  std::string match;
  std::string name;
  Grouping grouping = Grouping::Leaf;
  bool hidden = false;
  std::optional<bool> enabled;
  int64_t flags = 0;
  LeafInfo leaf;
  Content content;
  std::vector<Node> kids;
};

struct Layer {
  LayerRow row;
  Node root;
};

struct Comp {
  CompRow row;
  std::vector<Layer> layers;
  std::vector<Id> selected;
};

inline ValueRead number(double v);

// What a request needs from the plugin besides the host: the server info, the watch tracker and the library status.
struct Exec {
  ServerInfo info;
  WatchTracker watch;
  LibraryStatus library;
  ExecContext context() { return ExecContext{&info, &watch, &library}; }
};

// All state is public (tests build and poke the scene directly); the stream and layer refs it hands out point at tokens
// in the two registries.
struct Host : public HostReader {
  ProjectInfo projectInfo;
  std::vector<ItemRow> itemRows;
  std::vector<Comp> comps;
  std::set<StreamRef> open;
  uint64_t calls = 0;
  bool noProject = false;
  std::string failOnLeafMatch;
  bool domSkipsEffectInput = true;
  ScriptRevision scriptCost = [] {
    ScriptRevision cost;
    cost.revision = 42;
    cost.revisionRaw = "42";
    cost.revisionUs = 1500;
    cost.floorUs = 400;
    return cost;
  }();

  // The write prototype's seam. `scriptHook` stands in for After Effects running the script (it may change the scene);
  // without one a script answers "OK".
  std::vector<std::string> scripts;
  std::function<ScriptRun(const std::string& script, Host& host)> scriptHook;
  LibraryEntry library = [] {
    LibraryEntry entry;
    entry.entryFile = "/Library/Application Support/extynt/host/probe.jsx";
    entry.extensionDir = "/Library/Application Support/extynt/host";
    entry.version = "0.1.0+0123456789ab";
    return entry;
  }();
  // The host_call seam: what the host library's guard and entries answer when no scriptHook is set.
  std::map<std::string, std::string> entryAnswers;
  std::string libraryLoadError;
  bool libraryResident = false;
  int engineNotReadyCalls = 0;
  std::vector<EffectPopups> popups;
  std::vector<std::string> notes;
  int libraryLoads = 0;
  int64_t revision = 9264;
  bool revisionFails = false;
  int invalidations = 0;
  int beginRequests = 0;
  int contentCalls = 0;

  Comp* current = nullptr;
  std::vector<std::string> warnings;
  std::deque<StreamToken> nodeRefs;
  std::deque<LayerToken> layerRefs;

  // Sets the opacity leaf of a layer (what the real host does when the script's setValue runs).
  Layer* findLayer(const Id& compId, const Id& layerId);
  bool setOpacity(const Id& compId, const Id& layerId, double value);

  void note(const std::string& line) override { notes.push_back(line); }
  std::string guardAnswer();
  void beginRequest() override;
  [[nodiscard]] uint64_t getterCalls() const override { return calls; }
  std::vector<std::string> takeWarnings() override { return warnings; }

  ProjectInfo project() override;
  std::vector<ItemRow> items() override;
  bool openComp(const Id& id, CompRow& out) override;
  std::vector<Id> selectedLayerIds() override;
  LayerRef layerAt(int64_t index1, LayerRow& out) override;
  bool layerById(const Id& id, LayerRef& ref, LayerRow& out) override;
  StreamRef openLayerRoot(LayerRef layer) override;
  int64_t childCount(StreamRef group) override;
  StreamRef childAt(StreamRef group, int64_t index) override;
  NodeInfo describe(StreamRef ref) override;
  LeafInfo readLeaf(StreamRef ref, const ReadOptions& options) override;
  bool streamContentDigest(StreamRef ref, const LeafInfo& leafInfo, Hasher& into) override;
  int64_t firstChildIndex(StreamRef group, bool groupIsEffect) override;
  void closeStream(StreamRef ref) override { open.erase(ref); }
  ScriptRevision scriptRevision() override;
  [[nodiscard]] bool revisionGuard() const override { return revisionGuardOn; }
  bool revisionGuardOn = true;
  ScriptRun executeFixedScript(const std::string& script) override;
  LibraryEntry libraryEntry() override { return library; }
  std::vector<EffectPopups> layerEffectPopups([[maybe_unused]] LayerRef layer) override { return popups; }
  void invalidateCaches() override { ++invalidations; }
  std::optional<std::vector<EffectDialogFlag>> effectDialogFlags() override { return dialogFlags; }
  std::optional<std::vector<EffectDialogFlag>> dialogFlags;
  bool effectDialogScanPending() override { return dialogScanPending; }
  bool dialogScanPending = false;
  // What a script answers without a scriptHook: the revision, the library guard, an entry call, or "OK".
  ScriptRun defaultScript(const std::string& script);

  StreamRef track(Node* node);
  LayerRef trackLayer(Layer* layer);
  static Node& node(StreamRef ref) { return *ref.value->node; }
};

inline Node group(const std::string& match, const std::string& name, std::vector<Node> kids,
                  Grouping g = Grouping::Named) {
  Node n;
  n.match = match;
  n.name = name;
  n.grouping = g;
  n.kids = std::move(kids);
  return n;
}

inline Node leaf(const std::string& match, const std::string& name, ValueType type, ValueRead value) {
  Node n;
  n.match = match;
  n.name = name;
  n.leaf.type = type;
  n.leaf.value = std::move(value);
  return n;
}

inline ValueRead number(double v) {
  ValueRead r;
  r.kind = ValueRead::Kind::Number;
  r.v[0] = v;
  return r;
}

inline ValueRead vec2(double x, double y) {
  ValueRead r;
  r.kind = ValueRead::Kind::Vec2;
  r.v[0] = x;
  r.v[1] = y;
  return r;
}

inline ValueRead vec3(double x, double y, double z) {
  ValueRead r;
  r.kind = ValueRead::Kind::Vec3;
  r.v[0] = x;
  r.v[1] = y;
  r.v[2] = z;
  return r;
}

inline ValueRead color(double r, double g, double b, double a) {
  ValueRead v;
  v.kind = ValueRead::Kind::Color;
  v.v[0] = r;
  v.v[1] = g;
  v.v[2] = b;
  v.v[3] = a;
  return v;
}

inline ValueRead unsupported(const std::string& name) {
  ValueRead v;
  v.kind = ValueRead::Kind::Unsupported;
  v.unsupported = name;
  return v;
}

// Items 1 folder, 2 "Main" comp (layers 10 "Shape A", 11 "Null B"), 3 "Sub" comp (layer 20), 4 solid footage.
Host makeScene();

}

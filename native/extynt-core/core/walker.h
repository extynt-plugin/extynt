// The read-only walk: items, compositions, layers and the property tree, written in the
// snapshot shape apps/panel/host/probe.jsx produces, plus Merkle hashes (property -> layer
// -> composition -> project). Pure core: it only talks to a HostReader.
#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "hash128.h"
#include "host_reader.h"
#include "json_writer.h"
#include "path_segments.h"
#include "request.h"

namespace extynt {

struct WalkOptions {
  Detail detail = Detail::Full;
  // 0 = unlimited
  int64_t maxPropertiesPerLayer = 0;
  int maxPropertyDepth = 64;
  bool preExpression = false;
  // Add "hash" members to read output
  bool hashes = false;
  // Hash_project: list every property hash
  bool propertyHashes = false;
  // Entries carry the host's raw flag word as "dynFlags" (diagnostics only)
  bool debugFlags = false;
};

struct LayerHashRow {
  Id id;
  int64_t index = 0;
  std::string name;
  Hash128 hash;
  int64_t properties = 0;
  std::vector<std::pair<std::string, Hash128>> propertyHashes;
};

struct CompHashRow {
  Id id;
  std::string name;
  Hash128 hash;
  std::vector<LayerHashRow> layers;
};

struct ProjectHashes {
  Hash128 itemsHash;
  Hash128 projectHash;
  std::vector<CompHashRow> comps;
};

// One property read by path: what read_paths does for a single target, but structured instead of JSON text.
struct PathValue {
  bool found = false;
  // COMP_NOT_FOUND, LAYER_NOT_FOUND, BAD_PATH, PATH_NOT_FOUND or NOT_A_PROPERTY when !found
  std::string error;
  LeafInfo leaf;
};

class Walker {
 public:
  Walker(HostReader& host, const WalkOptions& options);

  // Each returns the JSON text of the response "result" member.
  std::string readProject();
  std::string readComp(const Id& compId);
  std::string readPaths(const std::vector<PathTarget>& targets);
  std::string hashProject();
  // Reads one property (opens the composition, finds the layer, resolves the path). Used by the write prototype to
  // verify.
  PathValue readValue(const PathTarget& target);

  [[nodiscard]] int64_t serializeNs() const { return serializeNs_; }
  [[nodiscard]] int64_t hashNs() const { return hashNs_; }
  // The part of hashNs() spent in the host folding key, text, marker, path and layer-reference content into row hashes.
  [[nodiscard]] int64_t contentNs() const { return contentNs_; }

 private:
  struct LayerWalk {
    // Entries are appended here when non-null
    JsonWriter* out = nullptr;
    // Property hashes are folded in when non-null
    Hasher* hasher = nullptr;
    // Per-property hash list when non-null
    LayerHashRow* rows = nullptr;
    int64_t count = 0;
    bool truncated = false;
    std::string layerName;
  };
  // The group a visit happens in. The views point at strings that outlive the visit.
  struct GroupScope {
    std::string_view prefix;
    std::string_view matchName;
    bool inEffect = false;
    int depth = 0;
    // The group itself is an effect (a direct child of the Effect Parade)
    bool isEffect = false;
  };
  struct ActiveComp {
    std::optional<CompRow> comp;
    std::vector<Id> selected;
  };
  // The composition the last read_paths target opened, so consecutive targets in it do not reopen it.
  struct CompCursor {
    Id openedId;
    bool open = false;
  };
  // The leaf behind a row being emitted; `info` is null for a group.
  struct EntryLeaf {
    StreamRef node;
    const LeafInfo* info = nullptr;
  };
  // One property node being visited and what the host said about it.
  struct ChildNode {
    StreamRef stream;
    const NodeInfo* info = nullptr;
  };
  struct ResolvedPath {
    StreamHandle stream;
    NodeInfo info;
    // The matchName of the node above `info`
    std::string parentMatchName;
    bool inEffect = false;
  };

  ProjectHashes walkProject(JsonWriter* out);
  ActiveComp openActiveComp(const ProjectInfo& project);
  Hash128 hashItems(const std::vector<ItemRow>& items);
  static void writeProjectOpening(JsonWriter& out, const ProjectInfo& project, const std::vector<ItemRow>& items,
                                  const ActiveComp& active);
  void walkComps(const std::vector<ItemRow>& items, JsonWriter* out, Hasher& projectHasher, ProjectHashes& result);
  static void writeProjectBlock(JsonWriter& writer, const ProjectInfo& project, int64_t itemCount);
  void walkComp(const CompRow& comp, JsonWriter* out, CompHashRow* hashes);
  void finishComp(const CompRow& comp, const Hash128& compHash, JsonWriter* out, CompHashRow* hashes);
  void beginLayerJson(JsonWriter* out, const LayerRow& row);
  void endLayerJson(JsonWriter* out, bool hashed, const Hash128& layerHash);
  void walkLayer(LayerRef ref, const LayerRow& row, JsonWriter* out, LayerHashRow* hashes);
  void walkProperties(LayerRef ref, JsonWriter* out, LayerWalk& walk);
  bool visitGroup(StreamRef group, const GroupScope& scope, LayerWalk& walk);
  bool visitRoot(StreamRef group, int64_t count, const GroupScope& scope, LayerWalk& walk);
  bool visitChild(const ChildNode& child, SiblingSegments& seen, const GroupScope& scope, LayerWalk& walk);
  bool overPropertyLimit(LayerWalk& walk);
  void emitEntry(LayerWalk& walk, const std::string& path, const EntryLeaf& leaf);
  Hash128 foldContent(const Hash128& entryHash, const EntryLeaf& leaf);
  std::string lookupPath(const PathTarget& target, CompCursor& cursor, LayerRow& row, ResolvedPath& resolved);
  bool resolvePath(LayerRef layer, const std::vector<PathSegment>& segments, ResolvedPath& out);
  bool findChild(StreamHandle& current, const PathSegment& segment, bool currentIsEffect, NodeInfo& info);
  void writePathResult(JsonWriter& w, const PathTarget& target, CompCursor& cursor);
  [[nodiscard]] bool wantHash() const;
  Hash128 timedHash(const std::string& text);
  Hash128 hashHead(const LayerRow& row);
  Hash128 hashHead(const CompRow& comp);
  void timedUpdate(Hasher& hasher, const Hash128& child);
  Hash128 timedDigest(const Hasher& hasher);
  void finishWarnings(JsonWriter& writer);

  HostReader* host_;
  WalkOptions opt_;
  int64_t serializeNs_ = 0;
  int64_t hashNs_ = 0;
  int64_t contentNs_ = 0;
  Hasher contentHasher_;
  std::string scratch_;
  std::vector<std::string> warnings_;
  bool hashing_ = false;
};

}

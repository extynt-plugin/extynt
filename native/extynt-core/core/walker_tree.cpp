// The property-tree traversal behind Walker: one entry per property or group, hashed and written as it is visited.

#include <string>
#include <string_view>
#include "hash128.h"
#include "host_reader.h"
#include "path_segments.h"
#include <cstdint>
#include <vector>
#include <cstddef>
#include "timing.h"
#include "walker.h"
#include "walker_json.h"

namespace extynt {

namespace {

constexpr std::string_view kContentFormat = "content3";

bool leafHasContent(const LeafInfo& leaf) {
  if (leaf.numKeys > 0) return true;
  return leaf.type == ValueType::Marker || leaf.type == ValueType::Mask || leaf.type == ValueType::TextDocument ||
         leaf.type == ValueType::LayerId;
}

}

bool Walker::overPropertyLimit(LayerWalk& walk) {
  if (opt_.maxPropertiesPerLayer <= 0 || walk.count < opt_.maxPropertiesPerLayer) return false;
  walk.truncated = true;
  warnings_.push_back("property-count-limit:" + walk.layerName);
  return true;
}

Hash128 Walker::foldContent(const Hash128& entryHash, const EntryLeaf& leaf) {
  const ScopedAccumulate hashTimer(hashNs_);
  const ScopedAccumulate contentTimer(contentNs_);
  contentHasher_.reset();
  contentHasher_.update(kContentFormat);
  contentHasher_.update(entryHash);
  if (!host_->streamContentDigest(leaf.node, *leaf.info, contentHasher_)) return entryHash;
  return contentHasher_.digest();
}

void Walker::emitEntry(LayerWalk& walk, const std::string& path, const EntryLeaf& leaf) {
  if (walk.hasher) {
    Hash128 entryHash = timedHash(scratch_);
    if (leaf.info && leafHasContent(*leaf.info)) entryHash = foldContent(entryHash, leaf);
    walk.hasher->update(entryHash);
    if (walk.rows && opt_.propertyHashes) walk.rows->propertyHashes.emplace_back(path, entryHash);
  }
  if (walk.out) {
    const ScopedAccumulate timer(serializeNs_);
    walk.out->raw(scratch_);
  }
}

bool Walker::visitChild(const ChildNode& child, SiblingSegments& seen, const GroupScope& scope, LayerWalk& walk) {
  const NodeInfo& info = *child.info;
  if (overPropertyLimit(walk)) return false;
  const std::string segment = seen.next(info.matchName, info.displayName);
  const std::string path = scope.prefix.empty() ? segment : std::string(scope.prefix) + "/" + segment;
  const bool nodeInEffect = scope.inEffect || scope.matchName == kEffectParadeMatchName;
  const bool isLeaf = info.grouping == Grouping::Leaf;
  LeafInfo leaf;
  if (isLeaf) leaf = host_->readLeaf(child.stream, ReadOptions{opt_.preExpression});
  {
    const ScopedAccumulate timer(serializeNs_);
    buildEntryJson(scratch_,
                   EntrySpec{path, scope.matchName, nodeInEffect, opt_.debugFlags, &info, isLeaf ? &leaf : nullptr});
  }
  emitEntry(walk, path, EntryLeaf{child.stream, isLeaf ? &leaf : nullptr});
  walk.count += 1;
  if (isLeaf) return true;
  const GroupScope inner{path, info.matchName, nodeInEffect, scope.depth + 1,
                         scope.matchName == kEffectParadeMatchName};
  return visitGroup(child.stream, inner, walk);
}

bool Walker::visitRoot(StreamRef group, int64_t count, const GroupScope& scope, LayerWalk& walk) {
  SiblingSegments seen;
  std::vector<StreamHandle> children;
  std::vector<NodeInfo> infos;
  std::vector<std::string> matchNames;
  for (int64_t i = 0; i < count; ++i) {
    children.emplace_back(*host_, host_->childAt(group, i));
    infos.push_back(host_->describe(children.back().get()));
    matchNames.push_back(infos.back().matchName);
  }
  for (const size_t index : rootVisitOrder(matchNames)) {
    if (!visitChild({children[index].get(), &infos[index]}, seen, scope, walk)) return false;
  }
  return true;
}

bool Walker::visitGroup(StreamRef group, const GroupScope& scope, LayerWalk& walk) {
  if (scope.depth > opt_.maxPropertyDepth) {
    warnings_.push_back("property-depth-limit:" + walk.layerName);
    return true;
  }
  const int64_t count = host_->childCount(group);
  if (scope.depth == 0) return visitRoot(group, count, scope, walk);
  SiblingSegments seen;
  for (int64_t i = scope.isEffect ? host_->firstChildIndex(group, true) : 0; i < count; ++i) {
    const StreamHandle child(*host_, host_->childAt(group, i));
    const NodeInfo info = host_->describe(child.get());
    if (!visitChild({child.get(), &info}, seen, scope, walk)) return false;
  }
  return true;
}

}

// Property reads by path (read_paths and the write prototype's verify): open the composition, find the layer, walk
// the encoded path segments down the property tree.

#include "host_reader.h"
#include "path_segments.h"
#include <cstdint>
#include <string>
#include <utility>
#include <vector>
#include "request.h"
#include "json_writer.h"
#include "walker.h"
#include "walker_json.h"

namespace extynt {

bool Walker::findChild(StreamHandle& current, const PathSegment& segment, bool currentIsEffect, NodeInfo& info) {
  const int64_t count = host_->childCount(current.get());
  int occurrence = 0;
  for (int64_t i = currentIsEffect ? host_->firstChildIndex(current.get(), true) : 0; i < count; ++i) {
    StreamHandle child(*host_, host_->childAt(current.get(), i));
    NodeInfo childInfo = host_->describe(child.get());
    const std::string encoded = encodePathSegment(segmentSource(childInfo.matchName, childInfo.displayName));
    if (encoded != segment.encodedBase || ++occurrence != segment.occurrence) continue;
    info = std::move(childInfo);
    current = std::move(child);
    return true;
  }
  return false;
}

bool Walker::resolvePath(LayerRef layer, const std::vector<PathSegment>& segments, ResolvedPath& out) {
  StreamHandle current(*host_, host_->openLayerRoot(layer));
  std::string currentMatch;
  for (const PathSegment& segment : segments) {
    NodeInfo childInfo;
    if (!findChild(current, segment, out.parentMatchName == kEffectParadeMatchName, childInfo)) return false;
    out.parentMatchName = currentMatch;
    out.inEffect = out.inEffect || currentMatch == kEffectParadeMatchName;
    currentMatch = childInfo.matchName;
    out.info = std::move(childInfo);
  }
  out.stream = std::move(current);
  return true;
}

std::string Walker::lookupPath(const PathTarget& target, CompCursor& cursor, LayerRow& row, ResolvedPath& resolved) {
  LayerRef ref;
  std::vector<PathSegment> segments;
  if (!cursor.open || cursor.openedId != target.compId) {
    CompRow comp;
    cursor.open = host_->openComp(target.compId, comp);
    cursor.openedId = target.compId;
  }
  if (!cursor.open) return "COMP_NOT_FOUND";
  if (!host_->layerById(target.layerId, ref, row)) return "LAYER_NOT_FOUND";
  if (!parsePath(target.path, segments)) return "BAD_PATH";
  if (!resolvePath(ref, segments, resolved)) return "PATH_NOT_FOUND";
  return "";
}

PathValue Walker::readValue(const PathTarget& target) {
  PathValue out;
  LayerRow row;
  ResolvedPath resolved;
  CompCursor cursor;
  out.error = lookupPath(target, cursor, row, resolved);
  if (!out.error.empty()) return out;
  if (resolved.info.grouping != Grouping::Leaf) {
    out.error = "NOT_A_PROPERTY";
    return out;
  }
  out.leaf = host_->readLeaf(resolved.stream.get(), ReadOptions{opt_.preExpression});
  out.found = true;
  return out;
}

void Walker::writePathResult(JsonWriter& w, const PathTarget& target, CompCursor& cursor) {
  w.beginObject();
  w.field("compId", target.compId);
  w.field("layerId", target.layerId);
  w.field("path", target.path);
  LayerRow row;
  ResolvedPath resolved;
  const std::string error = lookupPath(target, cursor, row, resolved);
  w.fieldBool("found", error.empty());
  if (!error.empty()) w.field("error", error);
  if (cursor.open && error != "LAYER_NOT_FOUND" && error != "COMP_NOT_FOUND") {
    w.key("layer");
    w.beginObject();
    writeLayerHead(w, row);
    w.endObject();
  }
  if (error.empty()) {
    const bool isLeaf = resolved.info.grouping == Grouping::Leaf;
    LeafInfo leaf;
    if (isLeaf) leaf = host_->readLeaf(resolved.stream.get(), ReadOptions{opt_.preExpression});
    buildEntryJson(scratch_, EntrySpec{target.path, resolved.parentMatchName, resolved.inEffect, opt_.debugFlags,
                                       &resolved.info, isLeaf ? &leaf : nullptr});
    w.key("entry");
    w.raw(scratch_);
  }
  w.endObject();
}

std::string Walker::readPaths(const std::vector<PathTarget>& targets) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("source", "native");
  w.key("results");
  w.beginArray();
  CompCursor cursor;
  for (const PathTarget& target : targets) writePathResult(w, target, cursor);
  w.endArray();
  finishWarnings(w);
  w.endObject();
  return text;
}

}

// Walks items, compositions, layers and properties through a HostReader and computes the Merkle hashes.

#include "walker.h"
#include <cstddef>
#include <string>
#include <cstdint>
#include <utility>
#include <vector>

#include "host_reader.h"
#include "hash128.h"
#include "json_writer.h"
#include "request.h"
#include "timing.h"
#include "walker_json.h"

namespace extynt {

namespace {

constexpr size_t kMaxReportedWarnings = 100;

}

Walker::Walker(HostReader& host, const WalkOptions& options) : host_(&host), opt_(options) {}

bool Walker::wantHash() const { return opt_.hashes || hashing_; }

Hash128 Walker::timedHash(const std::string& text) {
  const ScopedAccumulate timer(hashNs_);
  return hashText(text);
}

void Walker::timedUpdate(Hasher& hasher, const Hash128& child) {
  const ScopedAccumulate timer(hashNs_);
  hasher.update(child);
}

Hash128 Walker::timedDigest(const Hasher& hasher) {
  const ScopedAccumulate timer(hashNs_);
  return hasher.digest();
}

Hash128 Walker::hashHead(const LayerRow& row) {
  {
    const ScopedAccumulate timer(serializeNs_);
    scratch_.clear();
    JsonWriter head(scratch_);
    head.beginObject();
    writeLayerHead(head, row);
    head.endObject();
  }
  return timedHash(scratch_);
}

Hash128 Walker::hashHead(const CompRow& comp) {
  {
    const ScopedAccumulate timer(serializeNs_);
    scratch_.clear();
    JsonWriter head(scratch_);
    head.beginObject();
    writeCompHead(head, comp);
    head.endObject();
  }
  return timedHash(scratch_);
}

void Walker::walkProperties(LayerRef ref, JsonWriter* out, LayerWalk& walk) {
  if (out) {
    const ScopedAccumulate timer(serializeNs_);
    out->key("propertyPaths");
    out->beginArray();
    walk.out = out;
  }
  const StreamHandle root(*host_, host_->openLayerRoot(ref));
  visitGroup(root.get(), GroupScope{}, walk);
  if (out) {
    const ScopedAccumulate timer(serializeNs_);
    out->endArray();
    out->fieldBool("propertyPathsTruncated", walk.truncated);
  }
}

void Walker::beginLayerJson(JsonWriter* out, const LayerRow& row) {
  if (!out) return;
  const ScopedAccumulate timer(serializeNs_);
  out->beginObject();
  writeLayerHead(*out, row);
}

void Walker::endLayerJson(JsonWriter* out, bool hashed, const Hash128& layerHash) {
  if (!out) return;
  const ScopedAccumulate timer(serializeNs_);
  if (hashed && opt_.hashes) out->field("hash", layerHash.hex());
  out->endObject();
}

void Walker::walkLayer(LayerRef ref, const LayerRow& row, JsonWriter* out, LayerHashRow* hashes) {
  const bool hash = wantHash();
  Hasher hasher;
  if (hash) hasher.update(hashHead(row));
  beginLayerJson(out, row);
  LayerWalk walk;
  walk.layerName = row.name;
  if (hash) walk.hasher = &hasher;
  walk.rows = hashes;
  if (opt_.detail == Detail::Full) walkProperties(ref, out, walk);
  Hash128 layerHash;
  if (hash) layerHash = timedDigest(hasher);
  if (hashes) {
    hashes->id = row.id;
    hashes->index = row.index;
    hashes->name = row.name;
    hashes->hash = layerHash;
    hashes->properties = walk.count;
  }
  endLayerJson(out, hash, layerHash);
}

void Walker::walkComp(const CompRow& comp, JsonWriter* out, CompHashRow* hashes) {
  const bool hash = wantHash();
  Hasher hasher;
  if (hash) hasher.update(hashHead(comp));
  if (out) {
    const ScopedAccumulate timer(serializeNs_);
    out->beginObject();
    writeCompHead(*out, comp);
    out->key("layers");
    out->beginArray();
  }
  for (int64_t i = 1; i <= comp.numLayers; ++i) {
    LayerRow row;
    const LayerRef ref = host_->layerAt(i, row);
    LayerHashRow layerRow;
    walkLayer(ref, row, out, hashes ? &layerRow : nullptr);
    if (hash) timedUpdate(hasher, layerRow.hash);
    if (hashes) hashes->layers.push_back(std::move(layerRow));
  }
  Hash128 compHash;
  if (hash) compHash = timedDigest(hasher);
  finishComp(comp, compHash, out, hashes);
}

void Walker::finishComp(const CompRow& comp, const Hash128& compHash, JsonWriter* out, CompHashRow* hashes) {
  if (hashes) {
    hashes->id = comp.id;
    hashes->name = comp.name;
    hashes->hash = compHash;
  }
  if (out) {
    const ScopedAccumulate timer(serializeNs_);
    out->endArray();
    out->fieldBool("truncated", false);
    if (wantHash() && opt_.hashes) out->field("hash", compHash.hex());
    out->endObject();
  }
}

void Walker::writeProjectBlock(JsonWriter& w, const ProjectInfo& project, int64_t itemCount) {
  w.key("project");
  w.beginObject();
  w.field("name", project.name);
  if (project.filePath) w.field("filePath", *project.filePath);
  else w.fieldNull("filePath");
  w.fieldBool("dirty", project.dirty);
  w.endObject();
  w.fieldInt("itemCount", itemCount);
}

void Walker::finishWarnings(JsonWriter& w) {
  std::vector<std::string> all = host_->takeWarnings();
  all.insert(all.end(), warnings_.begin(), warnings_.end());
  w.key("warnings");
  w.beginArray();
  for (size_t i = 0; i < all.size() && i < kMaxReportedWarnings; ++i) w.str(all[i]);
  w.endArray();
  if (all.size() > kMaxReportedWarnings)
    w.fieldInt("warningsDropped", static_cast<int64_t>(all.size() - kMaxReportedWarnings));
}

Walker::ActiveComp Walker::openActiveComp(const ProjectInfo& project) {
  ActiveComp active;
  if (!project.activeCompId) return active;
  CompRow row;
  if (host_->openComp(*project.activeCompId, row)) {
    active.selected = host_->selectedLayerIds();
    active.comp = row;
  }
  return active;
}

Hash128 Walker::hashItems(const std::vector<ItemRow>& items) {
  {
    const ScopedAccumulate timer(serializeNs_);
    scratch_.clear();
    JsonWriter itemsJson(scratch_);
    itemsJson.beginObject();
    writeItemsAndSources(itemsJson, items);
    itemsJson.endObject();
  }
  return timedHash(scratch_);
}

void Walker::writeProjectOpening(JsonWriter& out, const ProjectInfo& project, const std::vector<ItemRow>& items,
                                 const ActiveComp& active) {
  out.beginObject();
  out.field("source", "native");
  writeProjectBlock(out, project, static_cast<int64_t>(items.size()));
  if (project.activeCompId) out.field("activeCompositionId", *project.activeCompId);
  else out.fieldNull("activeCompositionId");
  if (active.comp) out.fieldNum("currentTime", active.comp->currentTime);
  else out.fieldNull("currentTime");
  writeIdArray(out, "selectedLayerIds", active.selected);
  writeItemsAndSources(out, items);
  out.key("compositions");
  out.beginArray();
}

void Walker::walkComps(const std::vector<ItemRow>& items, JsonWriter* out, Hasher& projectHasher,
                       ProjectHashes& result) {
  for (const ItemRow& item : items) {
    if (item.kind != ItemKind::Comp) continue;
    CompRow comp;
    if (!host_->openComp(item.id, comp)) continue;
    CompHashRow compRow;
    walkComp(comp, out, wantHash() ? &compRow : nullptr);
    if (!wantHash()) continue;
    timedUpdate(projectHasher, compRow.hash);
    result.comps.push_back(std::move(compRow));
  }
}

ProjectHashes Walker::walkProject(JsonWriter* out) {
  ProjectHashes result;
  const ProjectInfo project = host_->project();
  const std::vector<ItemRow> items = host_->items();
  const ActiveComp active = openActiveComp(project);
  if (wantHash()) result.itemsHash = hashItems(items);
  if (out) {
    const ScopedAccumulate timer(serializeNs_);
    writeProjectOpening(*out, project, items, active);
  }
  Hasher projectHasher;
  if (wantHash()) timedUpdate(projectHasher, result.itemsHash);
  walkComps(items, out, projectHasher, result);
  if (wantHash()) result.projectHash = timedDigest(projectHasher);
  if (out) {
    const ScopedAccumulate timer(serializeNs_);
    out->endArray();
    if (wantHash() && opt_.hashes) {
      out->field("itemsHash", result.itemsHash.hex());
      out->field("projectHash", result.projectHash.hex());
    }
    finishWarnings(*out);
    out->endObject();
  }
  return result;
}

std::string Walker::readProject() {
  std::string text;
  JsonWriter writer(text);
  walkProject(&writer);
  return text;
}

std::string Walker::hashProject() {
  hashing_ = true;
  opt_.detail = Detail::Full;
  const ProjectHashes hashes = walkProject(nullptr);
  std::string text;
  JsonWriter w(text);
  const ScopedAccumulate timer(serializeNs_);
  w.beginObject();
  w.field("source", "native");
  w.field("algorithm", "xxh3-128");
  w.field("projectHash", hashes.projectHash.hex());
  w.field("itemsHash", hashes.itemsHash.hex());
  writeHashRows(w, hashes.comps, opt_.propertyHashes);
  finishWarnings(w);
  w.endObject();
  return text;
}

std::string Walker::readComp(const Id& compId) {
  CompRow comp;
  if (!host_->openComp(compId, comp)) throw HostFailure("composition " + compId + " not found", 0, "COMP_NOT_FOUND");
  const ProjectInfo project = host_->project();
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("source", "native");
  writeProjectBlock(w, project, 0);
  writeIdArray(w, "selectedLayerIds", host_->selectedLayerIds());
  w.key("compositions");
  w.beginArray();
  CompHashRow compRow;
  walkComp(comp, &w, wantHash() ? &compRow : nullptr);
  w.endArray();
  finishWarnings(w);
  w.endObject();
  return text;
}

}

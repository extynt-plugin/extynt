// Writes the walk's layer, composition, item and property members and the hash rows as JSON.

#include "walker_json.h"

#include <algorithm>
#include <optional>
#include <string>
#include <vector>

#include "host_reader.h"
#include "json_writer.h"
#include "layer_rules.h"
#include "path_segments.h"
#include "walker.h"

namespace extynt {

namespace {

const char* valueTypeName(ValueType type) {
  switch (type) {
    case ValueType::OneD: return "number";
    case ValueType::TwoD:
    case ValueType::TwoDSpatial:
    case ValueType::ThreeD:
    case ValueType::ThreeDSpatial: return "vector";
    case ValueType::Color: return "color";
    case ValueType::LayerId: return "layer";
    default: return "unknown";
  }
}

int vectorLength(ValueRead::Kind kind) {
  if (kind == ValueRead::Kind::Vec2) return 2;
  return kind == ValueRead::Kind::Vec3 ? 3 : 4;
}

void writeValue(JsonWriter& w, const ValueRead& value) {
  switch (value.kind) {
    case ValueRead::Kind::None: w.null(); return;
    case ValueRead::Kind::Number: w.num(value.v[0]); return;
    case ValueRead::Kind::Unsupported:
      w.beginObject();
      w.field("unsupported", value.unsupported);
      w.endObject();
      return;
    default: break;
  }
  w.beginArray();
  std::for_each(value.v.begin(), value.v.begin() + vectorLength(value.kind), [&w](double channel) { w.num(channel); });
  w.endArray();
}

void optionalId(JsonWriter& w, const char* name, const std::optional<Id>& id) {
  if (id) w.field(name, *id);
  else w.fieldNull(name);
}

void optionalBool(JsonWriter& w, const char* name, const std::optional<bool>& value) {
  if (value) w.fieldBool(name, *value);
  else w.fieldNull(name);
}

void optionalText(JsonWriter& w, const char* name, const std::optional<std::string>& value) {
  if (value) w.field(name, *value);
  else w.fieldNull(name);
}

void writeSwitches(JsonWriter& w, const LayerSwitches& s) {
  w.key("switches");
  w.beginObject();
  optionalText(w, "blend-mode", s.blendMode);
  optionalBool(w, "motion-blur", s.motionBlur);
  optionalBool(w, "collapse-transformation", s.collapseTransformation);
  optionalBool(w, "guide-layer", s.guideLayer);
  w.fieldNull("per-character-3d");
  optionalBool(w, "adjustment", s.adjustment);
  optionalBool(w, "effects-active", s.effectsActive);
  optionalText(w, "quality", s.quality);
  optionalText(w, "sampling", s.sampling);
  optionalText(w, "frame-blending", s.frameBlending);
  w.endObject();
}

const char* itemTypeName(ItemKind kind) {
  if (kind == ItemKind::Comp) return "composition";
  return kind == ItemKind::Folder ? "folder" : "footage";
}

}

namespace {

bool canSetValue(const EntrySpec& spec, bool isEffect) {
  const LeafInfo* leaf = spec.leaf;
  return (leaf != nullptr) && !isEffect && leaf->type != ValueType::NoData && leaf->type != ValueType::Arb &&
         (spec.inEffect || !spec.info->hidden);
}

const char* entryKind(bool isEffect, bool isLeaf) {
  if (isEffect) return "effect";
  return isLeaf ? "property" : "group";
}

void writeEntryHead(JsonWriter& w, const EntrySpec& spec, const char* kind, bool isEffect) {
  const LeafInfo* leaf = spec.leaf;
  w.beginObject();
  w.field("path", spec.path);
  w.field("matchName", spec.info->matchName);
  w.field("displayName", spec.info->displayName);
  w.field("kind", kind);
  w.field("valueType", leaf ? valueTypeName(leaf->type) : "unknown");
  w.key("value");
  if (leaf) writeValue(w, leaf->value);
  else w.null();
  w.fieldBool("canSetValue", canSetValue(spec, isEffect));
}

void writePropertyMembers(JsonWriter& w, const LeafInfo* leaf) {
  if (leaf && leaf->expressionEnabled) w.field("expression", leaf->expression);
  else w.fieldNull("expression");
  w.fieldBool("expressionEnabled", (leaf != nullptr) && leaf->expressionEnabled);
  if (leaf && leaf->numKeys > 0) w.fieldInt("keyframeCount", leaf->numKeys);
  if (leaf && !leaf->animatable) w.fieldBool("animatable", false);
}

}

void buildEntryJson(std::string& out, const EntrySpec& spec) {
  out.clear();
  JsonWriter w(out);
  const NodeInfo& info = *spec.info;
  const bool isEffect = spec.parentMatchName == kEffectParadeMatchName;
  const bool isLeaf = info.grouping == Grouping::Leaf;
  writeEntryHead(w, spec, entryKind(isEffect, isLeaf), isEffect);
  if (!isEffect && isLeaf) writePropertyMembers(w, spec.leaf);
  if (info.hidden) w.fieldBool("hidden", true);
  if ((isEffect || spec.parentMatchName == kLayerStylesMatchName) && info.enabled)
    w.fieldBool("enabled", *info.enabled);
  if (spec.debugFlags) w.fieldInt("dynFlags", info.rawFlags);
  w.endObject();
}

void writeLayerHead(JsonWriter& w, const LayerRow& r) {
  w.field("id", r.id);
  w.fieldInt("index", r.index);
  w.field("name", r.name);
  w.fieldBool("selected", r.selected);
  w.fieldInt("label", r.label);
  w.field("type", layerTypeName(r.type));
  w.fieldBool("enabled", r.enabled);
  w.fieldBool("shy", r.shy);
  w.fieldBool("solo", r.solo);
  w.fieldBool("locked", r.locked);
  w.fieldBool("threeD", r.threeD);
  optionalBool(w, "audioEnabled", r.audioEnabled);
  w.fieldNum("startTime", r.startTime);
  w.fieldNum("inPoint", r.inPoint);
  w.fieldNum("outPoint", r.outPoint);
  w.fieldNum("stretch", r.stretchPercent);
  optionalId(w, "parentId", r.parentId);
  optionalId(w, "matteLayerId", r.matteLayerId);
  w.field("matteType", matteTypeName(r.matteType));
  optionalId(w, "sourceId", r.sourceId);
  optionalId(w, "compositionSourceId", r.compositionSourceId);
  writeSwitches(w, r.switches);
}

void writeCompHead(JsonWriter& w, const CompRow& c) {
  w.field("id", c.id);
  w.field("name", c.name);
  w.key("backgroundColor");
  w.beginArray();
  for (const double channel : c.backgroundColor) w.num(channel);
  w.endArray();
  w.fieldInt("width", c.width);
  w.fieldInt("height", c.height);
  w.fieldNum("pixelAspect", c.pixelAspect);
  w.fieldNum("duration", c.duration);
  w.fieldNum("frameRate", c.frameRate);
  w.fieldNum("workAreaStart", c.workAreaStart);
  w.fieldNum("workAreaDuration", c.workAreaDuration);
  w.fieldNum("currentTime", c.currentTime);
}

void writeItemsAndSources(JsonWriter& w, const std::vector<ItemRow>& items) {
  w.key("items");
  w.beginArray();
  for (const ItemRow& item : items) {
    w.beginObject();
    w.field("id", item.id);
    w.field("name", item.name);
    w.field("type", itemTypeName(item.kind));
    optionalId(w, "parentFolderId", item.parentFolderId);
    if (item.kind == ItemKind::Comp) w.field("compositionId", item.id);
    else w.fieldNull("compositionId");
    if (item.kind == ItemKind::Footage) w.field("sourceId", item.id);
    else w.fieldNull("sourceId");
    w.endObject();
  }
  w.endArray();
  w.key("sources");
  w.beginArray();
  for (const ItemRow& item : items) {
    if (item.kind != ItemKind::Footage) continue;
    w.beginObject();
    w.field("id", item.id);
    w.field("name", item.name);
    w.field("type", item.still ? "solid" : "footage");
    w.fieldBool("missing", item.missing);
    w.fieldInt("width", item.width);
    w.fieldInt("height", item.height);
    w.fieldNum("duration", item.duration);
    w.endObject();
  }
  w.endArray();
}

void writeIdArray(JsonWriter& w, const char* name, const std::vector<Id>& ids) {
  w.key(name);
  w.beginArray();
  for (const Id& id : ids) w.str(id);
  w.endArray();
}

namespace {

void writePropertyHashes(JsonWriter& w, const LayerHashRow& layer) {
  w.key("propertyHashes");
  w.beginArray();
  for (const auto& entry : layer.propertyHashes) {
    w.beginObject();
    w.field("path", entry.first);
    w.field("hash", entry.second.hex());
    w.endObject();
  }
  w.endArray();
}

void writeLayerHashRow(JsonWriter& w, const LayerHashRow& layer, bool propertyHashes) {
  w.beginObject();
  w.field("id", layer.id);
  w.fieldInt("index", layer.index);
  w.field("name", layer.name);
  w.field("hash", layer.hash.hex());
  w.fieldInt("properties", layer.properties);
  if (propertyHashes) writePropertyHashes(w, layer);
  w.endObject();
}
}

void writeHashRows(JsonWriter& w, const std::vector<CompHashRow>& comps, bool propertyHashes) {
  w.key("compositions");
  w.beginArray();
  for (const CompHashRow& comp : comps) {
    w.beginObject();
    w.field("id", comp.id);
    w.field("name", comp.name);
    w.field("hash", comp.hash.hex());
    w.key("layers");
    w.beginArray();
    for (const LayerHashRow& layer : comp.layers) writeLayerHashRow(w, layer, propertyHashes);
    w.endArray();
    w.endObject();
  }
  w.endArray();
}

}

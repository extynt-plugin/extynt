// JSON writers for the walk's output: layer, composition and item members, the per-property entry and the hash rows.
// Internal to the walker; they only talk to a JsonWriter.
#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "host_reader.h"
#include "json_writer.h"
#include "walker.h"

namespace extynt {

// Everything one property entry is built from. `info` is always set, `leaf` only for a property that was read.
struct EntrySpec {
  std::string_view path;
  std::string_view parentMatchName;
  bool inEffect = false;
  bool debugFlags = false;
  const NodeInfo* info = nullptr;
  const LeafInfo* leaf = nullptr;
};

// Serializes one property-tree entry into `out` (cleared first).
void buildEntryJson(std::string& out, const EntrySpec& spec);

// The layer-level members, without propertyPaths. Called between beginObject/endObject by the caller.
void writeLayerHead(JsonWriter& w, const LayerRow& r);
void writeCompHead(JsonWriter& w, const CompRow& c);
void writeItemsAndSources(JsonWriter& w, const std::vector<ItemRow>& items);
void writeIdArray(JsonWriter& w, const char* name, const std::vector<Id>& ids);
void writeHashRows(JsonWriter& w, const std::vector<CompHashRow>& comps, bool propertyHashes);

}

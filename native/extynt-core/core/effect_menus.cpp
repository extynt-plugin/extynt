// Reads the popup parameters of one layer's effects and splits each '|'-separated menu text into item labels.

#include "effect_menus.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "host_reader.h"
#include "json_writer.h"
#include "request.h"

namespace extynt {

namespace {

std::string itemLabel(const std::string& raw) {
  if (raw.rfind("(-", 0) == 0) return "-";
  if (!raw.empty() && raw[0] == '(') return raw.substr(1);
  return raw;
}

std::vector<std::string> splitBar(const std::string& names) {
  std::vector<std::string> parts;
  size_t start = 0;
  for (;;) {
    const size_t bar = names.find('|', start);
    if (bar == std::string::npos) break;
    parts.push_back(names.substr(start, bar - start));
    start = bar + 1;
  }
  parts.push_back(names.substr(start));
  return parts;
}

void writePopup(JsonWriter& w, const PopupParam& popup) {
  const PopupItems split = splitPopupNames(popup.names, popup.numChoices);
  w.beginObject();
  w.field("matchName", popup.matchName);
  w.fieldInt("choices", popup.numChoices);
  w.fieldBool("consistent", split.matchesCount);
  w.key("items");
  w.beginArray();
  for (const std::string& item : split.items) w.str(item);
  w.endArray();
  w.endObject();
}

void writeEffect(JsonWriter& w, const EffectPopups& effect) {
  w.beginObject();
  w.field("matchName", effect.matchName);
  w.key("popups");
  w.beginArray();
  for (const PopupParam& popup : effect.popups) writePopup(w, popup);
  w.endArray();
  w.endObject();
}

}

PopupItems splitPopupNames(const std::string& names, int64_t numChoices) {
  PopupItems out;
  std::vector<std::string> parts = splitBar(names);
  if (parts.size() > 1 && parts.back().empty() && static_cast<int64_t>(parts.size()) > numChoices) parts.pop_back();
  for (const std::string& part : parts) {
    if (out.items.size() >= kMaxPopupItems) break;
    out.items.push_back(itemLabel(part));
  }
  out.matchesCount = parts.size() <= kMaxPopupItems && static_cast<int64_t>(out.items.size()) == numChoices;
  return out;
}

std::string runEffectMenus(HostReader& host, const Request& request) {
  CompRow comp;
  if (!host.openComp(request.compId, comp)) throw HostFailure("composition not found", 0, "COMP_NOT_FOUND");
  LayerRef layer;
  LayerRow row;
  if (!host.layerById(request.layerId, layer, row)) throw HostFailure("layer not found", 0, "LAYER_NOT_FOUND");
  const std::vector<EffectPopups> effects = host.layerEffectPopups(layer);
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("source", "native");
  w.key("effects");
  w.beginArray();
  for (const EffectPopups& effect : effects) writeEffect(w, effect);
  w.endArray();
  w.endObject();
  return text;
}

}

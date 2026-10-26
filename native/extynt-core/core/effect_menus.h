// effect_menus: the menu item labels of the popup parameters on one layer's effects, read-only. The host reports each
// popup as one '|'-separated text; this file splits it and writes the response.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "host_reader.h"
#include "request.h"

namespace extynt {

// The most items one popup reports; longer lists are cut here and flagged as not matching the stated count.
constexpr size_t kMaxPopupItems = 256;

struct PopupItems {
  // 1-based in the host; a separator slot is "-", a disabled item loses its "("
  std::vector<std::string> items;
  // The split produced exactly the number of choices the host stated
  bool matchesCount = false;
};

PopupItems splitPopupNames(const std::string& names, int64_t numChoices);

// Opens the composition, finds the layer and returns the JSON text of the response "result" member.
// Throws HostFailure COMP_NOT_FOUND or LAYER_NOT_FOUND.
std::string runEffectMenus(HostReader& host, const Request& request);

}

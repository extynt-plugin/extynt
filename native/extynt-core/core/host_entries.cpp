// The host entry table and its name lookups in both directions.
#include "host_entries.h"

#include <array>
#include <optional>
#include <string_view>
#include <utility>

namespace extynt {

namespace {

constexpr std::array<std::pair<std::string_view, HostEntry>, kHostEntryCount> kEntries = {{
    {"aeApplyPlan", HostEntry::ApplyPlan},
    {"aeUndoPlan", HostEntry::UndoPlan},
    {"aePreviewControlValues", HostEntry::PreviewControlValues},
    {"aeCaptureFrame", HostEntry::CaptureFrame},
    {"aeDiscardCaptureFrame", HostEntry::DiscardCaptureFrame},
    {"aeHostCensus", HostEntry::HostCensus},
    {"aeCatalogueProbePage", HostEntry::CatalogueProbePage},
    {"aeCatalogueReadInstance", HostEntry::CatalogueReadInstance},
    {"aeCollectIndexPage", HostEntry::CollectIndexPage},
    {"aeCollectDetailPage", HostEntry::CollectDetailPage},
    {"aeCollectValuePage", HostEntry::CollectValuePage},
    {"aeCollectBlurControl", HostEntry::CollectBlurControl},
    {"aeCollectEffectCreation", HostEntry::CollectEffectCreation},
    {"aeReadPropertyDetails", HostEntry::ReadPropertyDetails},
}};

}

std::string_view hostEntryName(HostEntry entry) {
  for (const auto& row : kEntries) {
    if (row.second == entry) return row.first;
  }
  return "";
}

std::optional<HostEntry> parseHostEntry(std::string_view name) {
  for (const auto& row : kEntries) {
    if (row.first == name) return row.second;
  }
  return std::nullopt;
}

}

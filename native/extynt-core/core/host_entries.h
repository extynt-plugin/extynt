// The fixed table of host jsx entry points a host_call may run (docs/native/protocol.md, 3.1). Nothing a socket client
// sends ever becomes script text: only a name from this table is looked up, and the arguments travel as an escaped
// string.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string_view>

namespace extynt {

enum class HostEntry : uint8_t {
  ApplyPlan,
  UndoPlan,
  PreviewControlValues,
  CaptureFrame,
  DiscardCaptureFrame,
  HostCensus,
  CatalogueProbePage,
  CatalogueReadInstance,
  CollectIndexPage,
  CollectDetailPage,
  CollectValuePage,
  CollectBlurControl,
  CollectEffectCreation,
  ReadPropertyDetails,
};

constexpr size_t kHostEntryCount = 14;

// The jsx function name of an entry ("aeApplyPlan").
std::string_view hostEntryName(HostEntry entry);

// The entry whose jsx function name is exactly `name`; nothing for any other text.
std::optional<HostEntry> parseHostEntry(std::string_view name);

}

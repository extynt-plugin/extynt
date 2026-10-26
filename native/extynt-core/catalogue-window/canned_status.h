// Canned engine statuses for previewing the catalogue window without a sidecar: the same five states as
// preview/CannedStatus.m on the Mac (from waiting to a finished run where Remove Grain was skipped and After Effects
// 2025 could not start). The window's --preview-screenshots and --preview-window modes use them.
#pragma once

#include <string>
#include <vector>

#include "catalogue_status.h"

namespace extynt::catalogue {

struct CannedStatus {
  std::string name;
  Status status;
};

// The six states with the sidecar's `language` answer set to `language`.
std::vector<CannedStatus> cannedStatuses(Language language = Language::En);

}

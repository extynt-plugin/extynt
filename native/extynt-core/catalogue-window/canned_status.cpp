// The canned engine statuses of the catalogue window's preview modes.
#include "canned_status.h"

#include <optional>
#include <utility>
#include <vector>

#include "catalogue_status.h"
#include "catalogue_text.h"

namespace extynt::catalogue {

namespace {

Host host(const char* year, const char* state, const char* phase, std::optional<HostResult> result = std::nullopt) {
  return Host{year, state, phase, std::move(result), {}};
}

Host ended(Host base, const char* reason) {
  base.reason = reason;
  return base;
}

}

std::vector<CannedStatus> cannedStatuses(Language language) {
  const Live learning{585, 312, 273, 300, 270000};
  const Live nearly{585, 540, 45, 528, 475000};
  const HostResult learned{585, 584, 1, 2, 4, {"Remove Grain"}};
  std::vector<CannedStatus> statuses = {
      {"1-waiting",
       Status{"running", {host("2026", "pending", "waiting"), host("2025", "pending", "waiting")}, Live{}}},
      {"2-starting",
       Status{"running", {host("2026", "running", "starting"), host("2025", "pending", "waiting")}, Live{}}},
      {"3-learning",
       Status{"running", {host("2026", "running", "learning"), host("2025", "pending", "waiting")}, learning}},
      {"4-nearly",
       Status{"running", {host("2026", "running", "learning"), host("2025", "pending", "waiting")}, nearly}},
      {"5-finished",
       Status{"done", {host("2026", "done", "finished", learned), host("2025", "failed", "finished")}, Live{}}},
      {"6-timed-out", Status{"failed",
                             {ended(host("2026", "failed", "finished"), "hung"),
                              ended(host("2025", "done", "finished", learned), "complete")},
                             Live{}}},
  };
  for (CannedStatus& canned : statuses) canned.status.language = language;
  return statuses;
}

}

// Project state sampling and change tracking for the watch stream (docs/native/protocol.md, 3.3, 3.4 and 4).
// Pure core: sampleWatch talks to a HostReader, WatchTracker only compares samples. Main thread only.
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "host_reader.h"

namespace extynt {

// As aeCollectionFocus
constexpr size_t kWatchMaxSelection = 256;
constexpr size_t kWatchMaxNamedLayers = 64;
constexpr size_t kWatchMaxNameBytes = 128;
// "app.project.revision"
extern const char* const kRevisionScript;

struct SelectedLayer {
  Id id;
  int64_t index = 0;
  std::string name;
};

struct WatchSample {
  bool hasProject = false;
  std::string projectName;
  std::optional<std::string> projectPath;
  std::optional<int64_t> revision;
  std::optional<int64_t> items;
  std::optional<Id> activeCompId;
  std::optional<std::string> activeCompName;
  std::optional<double> time;
  std::vector<Id> selection;
  std::vector<SelectedLayer> selectedLayers;
};

// The project's name, path, active comp id and revision: what the epoch needs. Empty (hasProject false) when no project
// is open.
WatchSample sampleIdentity(HostReader& host);

// The whole state. `previous` (the last full sample) lets it skip the item count and the layer names while the revision
// and the selection are unchanged.
WatchSample sampleWatch(HostReader& host, const WatchSample* previous);

class WatchTracker {
 public:
  // A full sample; also moves the epoch bookkeeping and keeps the sample for the next one's reuse.
  WatchSample take(HostReader& host);
  // The epoch after looking at the project's identity and revision only (host_call stamps with it).
  int64_t probeEpoch(HostReader& host);

  // A new subscriber wants the whole state: the next observation emits a `change` with reason ["initial"].
  void requestInitial() { initialPending_ = true; }
  // Whether claimSample would say yes, without recording anything.
  [[nodiscard]] bool sampleDue(double nowMs, int intervalMs) const;
  // True (and the sample time is recorded) when a sample is due: `intervalMs` since the last one, or an initial one
  // wanted.
  bool claimSample(double nowMs, int intervalMs);

  // The line to publish for `sample`: a `change` when it differs from the last one published (or is the first), a
  // `still` when nothing changed for `stillMs`, nothing otherwise.
  std::optional<std::string> observe(const WatchSample& sample, double nowMs, int stillMs);
  std::string hostClosingLine(double nowMs);

  [[nodiscard]] int64_t epoch() const { return epoch_; }
  [[nodiscard]] std::string stateJson(const WatchSample& sample) const;

 private:
  struct Identity {
    bool hasProject = false;
    std::string name;
    std::optional<std::string> path;
    bool operator==(const Identity& other) const {
      return hasProject == other.hasProject && name == other.name && path == other.path;
    }
  };

  void noteEpoch(const WatchSample& sample);
  std::string changeLine(const WatchSample& sample, const std::vector<const char*>& reasons, double nowMs);

  int64_t epoch_ = 1;
  std::optional<Identity> epochIdentity_;
  std::optional<int64_t> lastRevision_;
  // The last full sample taken
  std::optional<WatchSample> cache_;
  // The last sample a change line was published for
  std::optional<WatchSample> baseline_;
  bool initialPending_ = false;
  std::optional<double> lastSampleMs_;
  double lastEmitMs_ = 0;
  int64_t seq_ = 0;
};

}

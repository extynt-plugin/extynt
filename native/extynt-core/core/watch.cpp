// Samples project state through a HostReader and tracks what changed between samples.

#include "watch.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "host_reader.h"
#include "json_writer.h"

namespace extynt {

const char* const kRevisionScript = "app.project.revision";

namespace {

std::string cutUtf8(const std::string& text, size_t limit) {
  if (text.size() <= limit) return text;
  size_t length = limit;
  while (length > 0 && (static_cast<unsigned char>(text[length]) & 0xC0U) == 0x80U) --length;
  return text.substr(0, length);
}

std::optional<int64_t> parseRevision(const ScriptRun& run) {
  if (!run.error.empty() || run.result.empty() || run.result.size() > 15) return std::nullopt;
  int64_t value = 0;
  for (const char c : run.result) {
    if (c < '0' || c > '9') return std::nullopt;
    value = (value * 10) + (c - '0');
  }
  return value;
}

bool sameIdentity(const WatchSample& a, const WatchSample& b) {
  return a.hasProject == b.hasProject && a.projectName == b.projectName && a.projectPath == b.projectPath;
}

std::optional<int64_t> itemCount(HostReader& host, const WatchSample& sample, const WatchSample* previous) {
  const bool unchanged = previous != nullptr && previous->items && sample.revision &&
                         previous->revision == sample.revision && sameIdentity(*previous, sample);
  if (unchanged) return previous->items;
  try {
    return static_cast<int64_t>(host.items().size());
  } catch (const HostFailure&) {
    return std::nullopt;
  }
}

std::vector<SelectedLayer> namedLayers(HostReader& host, const std::vector<Id>& selection) {
  std::vector<SelectedLayer> named;
  for (size_t i = 0; i < selection.size() && i < kWatchMaxNamedLayers; ++i) {
    LayerRef ref;
    LayerRow row;
    if (!host.layerById(selection[i], ref, row)) continue;
    named.push_back(SelectedLayer{row.id, row.index, cutUtf8(row.name, kWatchMaxNameBytes)});
  }
  return named;
}

bool selectionReusable(const WatchSample& sample, const WatchSample* previous) {
  return previous != nullptr && sample.revision && previous->revision == sample.revision &&
         previous->activeCompId == sample.activeCompId && previous->selection == sample.selection;
}

void readActiveComp(HostReader& host, WatchSample& sample, const WatchSample* previous) {
  if (!sample.activeCompId) return;
  CompRow comp;
  if (!host.openComp(*sample.activeCompId, comp)) {
    sample.activeCompId.reset();
    return;
  }
  sample.activeCompName = cutUtf8(comp.name, kWatchMaxNameBytes);
  sample.time = comp.currentTime;
  sample.selection = host.selectedLayerIds();
  if (sample.selection.size() > kWatchMaxSelection) sample.selection.resize(kWatchMaxSelection);
  sample.selectedLayers =
      selectionReusable(sample, previous) ? previous->selectedLayers : namedLayers(host, sample.selection);
}

void writeOptionalText(JsonWriter& w, const char* name, const std::optional<std::string>& value) {
  if (value) w.field(name, *value);
  else w.fieldNull(name);
}

void writeOptionalInt(JsonWriter& w, const char* name, const std::optional<int64_t>& value) {
  if (value) w.fieldInt(name, *value);
  else w.fieldNull(name);
}

void writeSelection(JsonWriter& w, const WatchSample& sample) {
  w.key("selection");
  w.beginArray();
  for (const Id& id : sample.selection) w.str(id);
  w.endArray();
  w.key("selectedLayers");
  w.beginArray();
  for (const SelectedLayer& layer : sample.selectedLayers) {
    w.beginObject();
    w.field("id", layer.id);
    w.fieldInt("index", layer.index);
    w.field("name", layer.name);
    w.endObject();
  }
  w.endArray();
}

void writeStateFields(JsonWriter& w, const WatchSample& sample, int64_t epoch) {
  w.fieldInt("epoch", epoch);
  writeOptionalInt(w, "revision", sample.revision);
  writeOptionalInt(w, "items", sample.items);
  w.field("projectName", sample.projectName);
  writeOptionalText(w, "projectPath", sample.projectPath);
  writeOptionalText(w, "activeCompId", sample.activeCompId);
  writeOptionalText(w, "activeCompName", sample.activeCompName);
  if (sample.time && std::isfinite(*sample.time)) w.fieldNum("time", *sample.time);
  else w.fieldNull("time");
  writeSelection(w, sample);
}

bool sameTime(const std::optional<double>& a, const std::optional<double>& b) {
  if (a.has_value() != b.has_value()) return false;
  return !a || std::fabs(*a - *b) < 1e-9;
}

std::vector<const char*> differences(const WatchSample& before, const WatchSample& after) {
  std::vector<const char*> reasons;
  if (!sameIdentity(before, after)) reasons.push_back("project");
  if (before.revision != after.revision) reasons.push_back("revision");
  if (before.activeCompId != after.activeCompId) reasons.push_back("active");
  if (before.selection != after.selection) reasons.push_back("selection");
  if (!sameTime(before.time, after.time)) reasons.push_back("time");
  return reasons;
}

}

WatchSample sampleIdentity(HostReader& host) {
  WatchSample sample;
  ProjectInfo project;
  try {
    project = host.project();
  } catch (const HostFailure& failure) {
    if (failure.code() == "NO_PROJECT") return sample;
    throw;
  }
  sample.hasProject = true;
  sample.projectName = project.name;
  sample.projectPath = project.filePath;
  sample.activeCompId = project.activeCompId;
  if (host.revisionGuard()) sample.revision = parseRevision(host.executeFixedScript(kRevisionScript));
  return sample;
}

WatchSample sampleWatch(HostReader& host, const WatchSample* previous) {
  WatchSample sample = sampleIdentity(host);
  if (!sample.hasProject) return sample;
  sample.items = itemCount(host, sample, previous);
  readActiveComp(host, sample, previous);
  return sample;
}

void WatchTracker::noteEpoch(const WatchSample& sample) {
  const Identity identity{sample.hasProject, sample.projectName, sample.projectPath};
  if (!epochIdentity_) {
    epochIdentity_ = identity;
  } else if (!(*epochIdentity_ == identity)) {
    ++epoch_;
    epochIdentity_ = identity;
    lastRevision_.reset();
  }
  if (!sample.revision) return;
  if (lastRevision_ && *sample.revision < *lastRevision_) ++epoch_;
  lastRevision_ = sample.revision;
}

WatchSample WatchTracker::take(HostReader& host) {
  WatchSample sample = sampleWatch(host, cache_ ? &*cache_ : nullptr);
  noteEpoch(sample);
  cache_ = sample;
  return sample;
}

int64_t WatchTracker::probeEpoch(HostReader& host) {
  noteEpoch(sampleIdentity(host));
  return epoch_;
}

bool WatchTracker::sampleDue(double nowMs, int intervalMs) const {
  return !lastSampleMs_ || initialPending_ || nowMs - *lastSampleMs_ >= static_cast<double>(intervalMs);
}

bool WatchTracker::claimSample(double nowMs, int intervalMs) {
  if (!sampleDue(nowMs, intervalMs)) return false;
  lastSampleMs_ = nowMs;
  return true;
}

std::string WatchTracker::stateJson(const WatchSample& sample) const {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  writeStateFields(w, sample, epoch_);
  w.endObject();
  return text;
}

std::string WatchTracker::changeLine(const WatchSample& sample, const std::vector<const char*>& reasons, double nowMs) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("event", "change");
  w.fieldInt("seq", ++seq_);
  w.fieldNum("at", nowMs);
  writeStateFields(w, sample, epoch_);
  w.key("reason");
  w.beginArray();
  for (const char* reason : reasons) w.str(reason);
  w.endArray();
  w.endObject();
  return text;
}

std::optional<std::string> WatchTracker::observe(const WatchSample& sample, double nowMs, int stillMs) {
  std::vector<const char*> reasons;
  if (initialPending_ || !baseline_) reasons.push_back("initial");
  else reasons = differences(*baseline_, sample);
  if (!reasons.empty()) {
    baseline_ = sample;
    initialPending_ = false;
    lastEmitMs_ = nowMs;
    return changeLine(sample, reasons, nowMs);
  }
  if (nowMs - lastEmitMs_ < static_cast<double>(stillMs)) return std::nullopt;
  lastEmitMs_ = nowMs;
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("event", "still");
  w.fieldInt("seq", ++seq_);
  w.fieldNum("at", nowMs);
  w.fieldInt("epoch", epoch_);
  writeOptionalInt(w, "revision", sample.revision);
  w.endObject();
  return text;
}

std::string WatchTracker::hostClosingLine(double nowMs) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("event", "host-closing");
  w.fieldInt("seq", ++seq_);
  w.fieldNum("at", nowMs);
  w.field("reason", "death-hook");
  w.endObject();
  return text;
}

}

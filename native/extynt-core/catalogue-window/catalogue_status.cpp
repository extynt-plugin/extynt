// What "extynt Catalogue.exe" says and when: decodes the sidecar's engine status and turns it into the page's words,
// tags, rows and polling rules.
#include "catalogue_status.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "catalogue_text.h"
#include "json_decode.h"

namespace extynt::catalogue {

namespace {

long countOf(const JsonObject& object, const char* key) { return static_cast<long>(object.number(key).value_or(0)); }

std::vector<std::string> crashedOf(const JsonObject& result) {
  std::vector<std::string> crashed;
  const std::optional<JsonArray> names = result.array("crashed");
  for (size_t i = 0; names && i < names->size(); ++i) {
    if (std::optional<std::string> name = names->stringAt(i)) crashed.push_back(std::move(*name));
  }
  return crashed;
}

std::optional<HostResult> resultOf(const JsonObject& host) {
  const std::optional<JsonObject> result = host.object("result");
  if (!result) return std::nullopt;
  HostResult out;
  out.installed = countOf(*result, "installed");
  out.collected = countOf(*result, "collected");
  out.failed = countOf(*result, "failed");
  out.needsSource = countOf(*result, "needsSource");
  out.deferred = countOf(*result, "deferred");
  out.crashed = crashedOf(*result);
  return out;
}

Host hostOf(const JsonObject& entry) {
  Host host;
  host.year = entry.string("year").value_or("");
  host.state = entry.string("state").value_or("");
  host.phase = entry.string("phase").value_or("");
  host.reason = entry.string("reason").value_or("");
  host.result = resultOf(entry);
  return host;
}

std::vector<Host> hostsOf(const JsonObject& engine) {
  std::vector<Host> hosts;
  const std::optional<JsonArray> list = engine.array("hosts");
  for (size_t i = 0; list && i < list->size(); ++i) {
    if (const std::optional<JsonObject> entry = list->objectAt(i)) hosts.push_back(hostOf(*entry));
  }
  return hosts;
}

Live liveOf(const JsonObject& engine) {
  Live live;
  const std::optional<JsonObject> counts = engine.object("catalogue");
  if (!counts) return live;
  live.installed = countOf(*counts, "installed");
  live.collected = countOf(*counts, "collected");
  live.pending = countOf(*counts, "pending");
  live.probedThisRun = countOf(*counts, "probedThisRun");
  live.totalProbeMs = countOf(*counts, "totalProbeMs");
  return live;
}

std::vector<std::string> crashedNames(const std::vector<Host>& hosts) {
  std::vector<std::string> crashed;
  for (const Host& host : hosts) {
    if (!host.result) continue;
    for (const std::string& name : host.result->crashed) {
      if (std::find(crashed.begin(), crashed.end(), name) == crashed.end()) crashed.push_back(name);
    }
  }
  return crashed;
}

long laterCount(const std::vector<Host>& hosts) {
  long later = 0;
  for (const Host& host : hosts) {
    if (host.result) later = std::max(later, host.result->deferred + host.result->needsSource);
  }
  return later;
}

Text workingTag(const std::string& phase) {
  if (phase == "restarting") return Text::TagRestarting;
  if (phase == "reading-effects") return Text::TagListing;
  return phase == "learning" ? Text::TagLearning : Text::TagStarting;
}

std::string joined(Language language, const std::vector<std::string>& parts, Text separator) {
  std::string out;
  for (std::size_t index = 0; index < parts.size(); index++) {
    if (index > 0) out += say(language, separator);
    out += parts[index];
  }
  return out;
}

std::string crashedNote(Language language, const std::vector<std::string>& crashed) {
  constexpr std::size_t kShownNames = 3;
  const std::size_t shown = std::min(crashed.size(), kShownNames);
  const std::vector<std::string> head(crashed.begin(), crashed.begin() + static_cast<std::ptrdiff_t>(shown));
  std::string names = joined(language, head, Text::CrashedListSeparator);
  if (crashed.size() > shown) {
    names = say(language, Text::CrashedListMore, {{"names", names}, {"count", std::to_string(crashed.size() - shown)}});
  }
  return sayCount(language, Text::CrashedNote, static_cast<long>(crashed.size()), {{"names", names}});
}

bool retryableReason(const std::string& reason) {
  return !reason.empty() && reason != "complete" && reason != "after-effects-open";
}

struct FailureTexts {
  Text row;
  Text foot;
};

FailureTexts failureTexts(const std::string& reason) {
  static const std::array<std::pair<const char*, FailureTexts>, 8> kFailures = {{
      {"hung", {Text::RowTimedOut, Text::FootTimedOut}},
      {"stalled", {Text::RowTimedOut, Text::FootTimedOut}},
      {"time-limit", {Text::RowTimedOut, Text::FootTimedOut}},
      {"start-failed", {Text::RowDidntStart, Text::FootDidntStart}},
      {"census-failed", {Text::RowDidntAnswer, Text::FootDidntAnswer}},
      {"modal-blocked", {Text::RowBlocked, Text::FootBlocked}},
      {"crashed", {Text::RowCrashing, Text::FootCrashing}},
      {"after-effects-open", {Text::RowOpen, Text::FootOpen}},
  }};
  for (const auto& [key, texts] : kFailures) {
    if (reason == key) return texts;
  }
  if (reason.rfind("paused", 0) == 0) return {Text::RowPaused, Text::FootPaused};
  return {Text::RowUnfinished, Text::FootUnfinished};
}

}

std::string failurePhrase(Language language, const std::string& reason) {
  return say(language, failureTexts(reason).row);
}

std::optional<Status> parseResponse(std::string_view body) {
  const ObjectDocument document = readObjectDocument(body);
  if (!document.object || document.object->boolean("ok") != true) return std::nullopt;
  const std::optional<JsonObject> engine = document.object->object("engine");
  if (!engine) return std::nullopt;
  Status status;
  status.state = engine->string("state").value_or("");
  status.hosts = hostsOf(*engine);
  status.live = liveOf(*engine);
  status.language = languageFromCode(document.object->string("language").value_or(""));
  return status;
}

std::string liveDetail(Language language, const Live& live) {
  const Arguments counts = {{"collected", std::to_string(live.collected)},
                            {"installed", std::to_string(live.installed)}};
  if (live.probedThisRun < 20 || live.pending == 0 || live.totalProbeMs == 0) {
    return say(language, Text::LiveProgress, counts);
  }
  const double seconds = static_cast<double>(live.pending) * static_cast<double>(live.totalProbeMs) /
                         static_cast<double>(live.probedThisRun) / 1000.0;
  if (seconds < 60) return say(language, Text::LiveUnderMinute, counts);
  return sayCount(language, Text::LiveMinutes, static_cast<long>(std::ceil(seconds / 60.0)), counts);
}

std::string hostStatus(Language language, const Host& host) {
  if (host.phase == "waiting" || host.phase == "starting" || host.phase == "learning") return "";
  if (host.phase == "restarting") return say(language, Text::StatusRestarting);
  if (host.phase == "reading-effects") return say(language, Text::StatusListing);
  if (!host.result) return failurePhrase(language, host.reason);
  const Arguments collected = {{"collected", std::to_string(host.result->collected)}};
  const Text key = host.state == "done" ? Text::StatusLearned : Text::StatusLearnedPartly;
  return sayCount(language, key, host.result->installed, collected);
}

Tag kindOf(const Host& host) {
  if (host.state == "running") return Tag::Working;
  if (host.state == "done" && host.result) return Tag::Done;
  if (host.state == "done" || host.state == "failed") return Tag::Later;
  return Tag::Waiting;
}

std::string tagWord(Language language, const Host& host) {
  switch (kindOf(host)) {
    case Tag::Waiting: return say(language, Text::TagWaiting);
    case Tag::Working: return say(language, workingTag(host.phase));
    case Tag::Done: return say(language, Text::TagDone);
    case Tag::Later: return say(language, host.result ? Text::TagPartly : Text::TagLater);
  }
  return say(language, Text::TagWaiting);
}

std::string skippedNote(Language language, const std::vector<Host>& hosts) {
  const std::vector<std::string> crashed = crashedNames(hosts);
  const long later = laterCount(hosts);
  std::vector<std::string> notes;
  if (!crashed.empty()) notes.push_back(crashedNote(language, crashed));
  if (later > 0) notes.push_back(sayCount(language, Text::LaterNote, later));
  return joined(language, notes, Text::NoteJoiner);
}

void Page::showHeading(const std::string& headingText, const std::string& detailText, const std::string& noteText) {
  heading = headingText;
  detail = detailText;
  note = noteText;
}

void Page::showRows(const std::vector<Host>& hosts) {
  rows.clear();
  const std::size_t shown = std::min(hosts.size(), kMaxHosts);
  for (std::size_t index = 0; index < shown; index++) {
    const Host& host = hosts[index];
    rows.push_back(Row{kindOf(host), tagWord(language, host), say(language, Text::HostName, {{"year", host.year}}),
                       hostStatus(language, host)});
  }
  versionCount = sayCount(language, Text::VersionCount, static_cast<long>(shown));
}

void Page::showStarting() {
  eyebrow = say(language, Text::EyebrowStarting);
  bar.hidden = false;
  bar.indeterminate = true;
  showRows({});
  showHeading(say(language, Text::StartingHeading), say(language, Text::StartingDetail),
              say(language, Text::StartingNote));
}

void Page::showGaveUp(Text why) {
  eyebrow = say(language, Text::EyebrowLater);
  bar.hidden = true;
  showHeading(say(language, Text::GaveUpHeading), say(language, why), say(language, Text::GaveUpNote));
}

Outcome Page::render(const Status& status) {
  if (status.language != language) {
    language = status.language;
    showStarting();
  }
  footnote.clear();
  retryable = false;
  showRows(status.hosts);
  if (status.hosts.empty()) return Outcome::NoHosts;
  if (status.state == "done" || status.state == "failed") {
    showFinished(status.hosts);
    return Outcome::Finished;
  }
  showLive(status.hosts, status.live);
  return Outcome::Running;
}

void Page::showLive(const std::vector<Host>& hosts, const Live& live) {
  const Host* running = nullptr;
  for (const Host& host : hosts) {
    if (host.state == "running") running = &host;
  }
  if (!running || running->phase != "learning" || live.installed == 0) return;
  eyebrow = say(language, Text::EyebrowLive, {{"year", running->year}});
  bar.indeterminate = false;
  bar.fraction = std::clamp(static_cast<double>(live.collected) / static_cast<double>(live.installed), 0.0, 1.0);
  detail = liveDetail(language, live);
}

namespace {

bool failedReason(const std::string& reason) { return retryableReason(reason); }

bool openReason(const std::string& reason) { return reason == "after-effects-open"; }

bool blockedReason(const std::string& reason) { return reason == "modal-blocked"; }

const Host* firstWith(const std::vector<Host>& hosts, bool (*wanted)(const std::string&)) {
  for (const Host& host : hosts) {
    if (wanted(host.reason)) return &host;
  }
  return nullptr;
}

std::string failureNote(Language language, const std::vector<Host>& hosts, const std::string& skipped) {
  std::vector<std::string> notes;
  if (firstWith(hosts, blockedReason) != nullptr) notes.push_back(say(language, Text::FailedCloseDialog));
  if (!skipped.empty()) notes.push_back(skipped);
  notes.push_back(say(language, Text::FailedKept));
  return joined(language, notes, Text::NoteJoiner);
}

}

void Page::showFinished(const std::vector<Host>& hosts) {
  bool anyLearned = false;
  for (const Host& host : hosts) anyLearned = anyLearned || (host.result && host.result->collected > 0);
  eyebrow = say(language, Text::EyebrowDone);
  bar.indeterminate = false;
  bar.fraction = 1;
  const std::string skipped = skippedNote(language, hosts);
  showFooter(hosts);
  if (retryable) {
    showHeading(say(language, Text::FailedHeading), say(language, Text::FailedDetail),
                failureNote(language, hosts, skipped));
    return;
  }
  showHeading(say(language, anyLearned ? Text::FinishedHeading : Text::GaveUpHeading),
              say(language, Text::FinishedDetail),
              skipped.empty() ? say(language, Text::FinishedNoneSkipped) : skipped);
}

void Page::showFooter(const std::vector<Host>& hosts) {
  if (const Host* failed = firstWith(hosts, failedReason)) {
    footnote = say(language, failureTexts(failed->reason).foot, {{"year", failed->year}});
    retryable = true;
  } else if (firstWith(hosts, openReason) != nullptr) {
    footnote = say(language, Text::FootOpen);
  }
}

Poller::Next Poller::tick(double now, bool haveSession) {
  if (busy_ || ended_) return Next::Nothing;
  if (!haveSession) {
    if (now - startedAt_ > kSessionWaitSeconds) giveUp(Text::GaveUpHelper, now);
    return Next::Nothing;
  }
  return posted_ ? Next::Get : Next::Post;
}

void Poller::sessionChanged() {
  if (!ended_) posted_ = false;
}

void Poller::sent(Next request) {
  if (request == Next::Nothing) return;
  busy_ = true;
  wasPost_ = request == Next::Post;
}

void Poller::received(const std::optional<Status>& status, double now) {
  busy_ = false;
  if (ended_) return;
  if (!status) {
    if (wasPost_) giveUp(Text::GaveUpStart, now);
    return;
  }
  posted_ = true;
  const Outcome outcome = page_.render(*status);
  if (outcome == Outcome::NoHosts) giveUp(Text::GaveUpNoHosts, now);
  if (outcome == Outcome::Finished) end(now);
}

void Poller::retry() {
  if (!ended_ || !page_.retryable || busy_) return;
  page_.footnote.clear();
  page_.retryable = false;
  ended_ = false;
  posted_ = false;
}

void Poller::giveUp(Text why, double now) {
  end(now);
  page_.showGaveUp(why);
}

void Poller::end(double now) {
  ended_ = true;
  endedAt_ = now;
}

}

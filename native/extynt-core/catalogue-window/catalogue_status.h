// What "extynt Catalogue.exe" says and when, apart from how it is drawn and how it talks to the sidecar: the engine
// status (GET /v1/catalogue/engine's "engine"), the words and tags of each state, the heading/detail/note, and the
// polling rules. A line-for-line port of packaging/macos/release/catalogue-window/CatalogueWords.m and CatalogueView.m
// (the words) and CatalogueWindow.m (the rules); change the two together. Pure C++, no OS APIs: the unit tests run on
// every platform.
#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "catalogue_text.h"

namespace extynt::catalogue {

constexpr double kPollSeconds = 1;
constexpr double kSessionWaitSeconds = 60;
constexpr double kSummarySeconds = 90;
constexpr std::size_t kMaxHosts = 4;

enum class Outcome { Running, Finished, NoHosts };
enum class Tag { Waiting, Working, Done, Later };

// One version's frozen outcome once its engine work has ended.
struct HostResult {
  long installed = 0;
  long collected = 0;
  long failed = 0;
  long needsSource = 0;
  long deferred = 0;
  std::vector<std::string> crashed;
};

// One After Effects version's engine progress. `state` is pending, running, done or failed; `phase` is waiting,
// starting, reading-effects, learning, restarting or finished. `reason` is how its engine work last ended (complete,
// hung, stalled, time-limit, start-failed, census-failed, modal-blocked, crashed, after-effects-open, ...), empty while
// it has not ended.
struct Host {
  std::string year;
  std::string state;
  std::string phase;
  std::optional<HostResult> result;
  std::string reason;
};

// The catalogue's live counts (the version being collected now).
struct Live {
  long installed = 0;
  long collected = 0;
  long pending = 0;
  long probedThisRun = 0;
  long totalProbeMs = 0;
};

// The engine as a whole; `state` is idle, running, done or failed.
struct Status {
  std::string state;
  std::vector<Host> hosts;
  Live live;
  // The interface language the sidecar answered with (its `language` field); English when it named none.
  Language language = Language::En;
};

// The "engine" object of a sidecar response; nothing unless the body is JSON with ok:true and an engine object.
std::optional<Status> parseResponse(std::string_view body);

// One receipt row: a tag (kind + word), the version and what its engine is doing (empty when the tag says it).
struct Row {
  Tag kind = Tag::Waiting;
  std::string tag;
  std::string name;
  std::string status;
};

// The bar: hidden, a sliding block while the total is unknown, or a fraction (0..1) the view eases to.
struct Bar {
  bool hidden = false;
  bool indeterminate = true;
  double fraction = 0;
};

// The page: everything the window draws, as text and numbers, in `language` (adopted from each status that names a
// different one). `versionCount` is the receipt head's "N versions".
class Page {
 public:
  std::string eyebrow;
  std::string heading;
  std::string detail;
  std::string note;
  Bar bar;
  std::vector<Row> rows;
  Language language = Language::En;
  std::string versionCount = sayCount(Language::En, Text::VersionCount, 0);
  // The footer's line once a run has ended: a version whose scan failed (timed out, did not start, blocked by a dialog,
  // crashed; then `retryable`, so the window offers a retry) or one that is open in After Effects. Empty otherwise.
  std::string footnote;
  bool retryable = false;

  // The page before any status arrives.
  void showStarting();
  // The page when nothing could be learned here; `why` is the key of one short sentence.
  void showGaveUp(Text why);
  // Applies an engine status: rows, bar and, once it has ended, the summary.
  Outcome render(const Status& status);

 private:
  void showHeading(const std::string& headingText, const std::string& detailText, const std::string& noteText);
  void showRows(const std::vector<Host>& hosts);
  void showLive(const std::vector<Host>& hosts, const Live& live);
  void showFinished(const std::vector<Host>& hosts);
  void showFooter(const std::vector<Host>& hosts);
};

// The progress line "312 of 585", with " · about 5 minutes left" once enough has been measured.
std::string liveDetail(Language language, const Live& live);
// What one version's engine is doing now, or how it ended; empty when the tag already says it.
std::string hostStatus(Language language, const Host& host);
// How one version's scan ended, as the receipt row says it: "timed out", "didn't start", ...
std::string failurePhrase(Language language, const std::string& reason);
Tag kindOf(const Host& host);
std::string tagWord(Language language, const Host& host);
// The skipped effects in plain words, across every version that finished; empty when none.
std::string skippedNote(Language language, const std::vector<Host>& hosts);

// The window's rules, as CatalogueWindow.m has them: wait for the sidecar's session (up to kSessionWaitSeconds), POST
// once to start, then GET every kPollSeconds; a first answer that is not a status gives up, a later one is ignored;
// when the run ends the summary stays kSummarySeconds. Times are seconds on any monotonic clock the caller reads.
class Poller {
 public:
  Poller(Page& page, double startedAt) : page_(page), startedAt_(startedAt) {}

  enum class Next { Nothing, Post, Get };
  // Called once a second. Says which request to send now; Nothing while one is in flight, after the end, or while
  // waiting for the session (which gives up after kSessionWaitSeconds).
  Next tick(double now, bool haveSession);
  // The sidecar's session changed (it restarted): start the run again with a POST, since the new engine knows nothing
  // of the one this window was following.
  void sessionChanged();
  // The request tick() asked for was sent (so the next tick waits for its answer).
  void sent(Next request);
  // Its answer: the parsed status, or nothing when the sidecar did not answer with one.
  void received(const std::optional<Status>& status, double now);
  // The user asked again after a scan timed out: the next tick POSTs a new run. Does nothing unless the page offers it.
  void retry();

  [[nodiscard]] bool ended() const { return ended_; }
  // True once the summary has stood for kSummarySeconds, unless a retry is offered: the window waits for the user then.
  [[nodiscard]] bool closeDue(double now) const {
    return ended_ && !page_.retryable && now - endedAt_ >= kSummarySeconds;
  }

 private:
  void giveUp(Text why, double now);
  void end(double now);

  Page& page_;
  double startedAt_ = 0;
  double endedAt_ = 0;
  bool posted_ = false;
  bool ended_ = false;
  bool busy_ = false;
  bool wasPost_ = false;
};

}

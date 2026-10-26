// The catalogue window's words and rules (catalogue-window/catalogue_status.cpp), checked against the Mac window's
// CatalogueWords.m, CatalogueView.m and CatalogueWindow.m that they are ported from.
#include <cstddef>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "canned_status.h"
#include "catalogue_status.h"
#include "catalogue_text.h"
#include "testing.h"

using namespace extynt::catalogue;

namespace {

const char* const kLearning =
    R"({"ok":true,"engine":{"state":"running","hosts":[{"year":"2026","state":"running","phase":"learning","result":null},)"
    R"({"year":"2025","state":"pending","phase":"waiting","result":null}],)"
    R"("catalogue":{"installed":585,"collected":312,"pending":273,"probedThisRun":300,"totalProbeMs":270000}}})";

const char* const kFinished =
    R"({"ok":true,"engine":{"state":"done","hosts":[{"year":"2026","state":"done","phase":"finished","result":)"
    R"({"installed":585,"collected":584,"failed":1,"needsSource":2,"deferred":4,"crashed":["Remove Grain"]}},)"
    R"({"year":"2025","state":"failed","phase":"finished","result":null}],"catalogue":{}}})";

Status parsed(const char* body) { return extynt::catalogue::parseResponse(body).value_or(Status{}); }

TEST(catalogue_response_needs_ok_and_an_engine) {
  CHECK(!parseResponse("").has_value());
  CHECK(!parseResponse("not json").has_value());
  CHECK(!parseResponse(R"({"ok":false,"engine":{}})").has_value());
  CHECK(!parseResponse(R"({"ok":true})").has_value());
  CHECK(parseResponse(R"({"ok":true,"engine":{"state":"idle"}})").has_value());
}

TEST(catalogue_starting_page_is_the_mac_copy) {
  Page page;
  page.showStarting();
  CHECK_EQ(page.eyebrow, std::string("EFFECT CATALOGUE \xC2\xB7 NO WINDOW OPENS"));
  CHECK_EQ(page.heading, std::string("Learning every effect you own"));
  CHECK_EQ(page.detail, std::string("Starting After Effects. No window opens."));
  CHECK_EQ(page.note, std::string("Continue whenever. It finishes in the background."));
  CHECK(page.bar.indeterminate);
  CHECK(page.rows.empty());
}

TEST(catalogue_live_page_follows_the_running_version) {
  Page page;
  page.showStarting();
  CHECK(page.render(parsed(kLearning)) == Outcome::Running);
  CHECK_EQ(page.eyebrow, std::string("EFFECT CATALOGUE \xC2\xB7 AFTER EFFECTS 2026"));
  CHECK(!page.bar.indeterminate);
  CHECK_EQ(page.detail, std::string("312 of 585 \xC2\xB7 about 5 minutes left"));
  CHECK_EQ(page.versionCount, std::string("2 versions"));
  CHECK_EQ(page.rows.size(), static_cast<std::size_t>(2));
  CHECK_EQ(page.rows[0].tag, std::string("LEARNING"));
  CHECK(page.rows[0].kind == Tag::Working);
  CHECK_EQ(page.rows[1].tag, std::string("WAITING"));
  CHECK_EQ(page.rows[1].name, std::string("After Effects 2025"));
}

TEST(catalogue_time_left_needs_a_measurement) {
  const Language en = Language::En;
  CHECK_EQ(liveDetail(en, Live{585, 10, 575, 19, 9000}), std::string("10 of 585"));
  CHECK_EQ(liveDetail(en, Live{585, 585, 0, 300, 270000}), std::string("585 of 585"));
  CHECK_EQ(liveDetail(en, Live{585, 540, 45, 528, 475000}), std::string("540 of 585 \xC2\xB7 under a minute left"));
  CHECK_EQ(liveDetail(en, Live{585, 312, 273, 300, 270000}), std::string("312 of 585 \xC2\xB7 about 5 minutes left"));
  CHECK_EQ(liveDetail(en, Live{585, 312, 100, 20, 20000}), std::string("312 of 585 \xC2\xB7 about 2 minutes left"));
  CHECK_EQ(liveDetail(en, Live{585, 312, 60, 20, 20000}), std::string("312 of 585 \xC2\xB7 about 1 minute left"));
}

TEST(catalogue_finished_page_says_what_was_learned_and_skipped) {
  Page page;
  CHECK(page.render(parsed(kFinished)) == Outcome::Finished);
  CHECK_EQ(page.eyebrow, std::string("EFFECT CATALOGUE \xC2\xB7 DONE"));
  CHECK_EQ(page.heading, std::string("Your effects are learned"));
  CHECK_EQ(page.detail, std::string("That's it. Click Done."));
  CHECK_EQ(page.note,
           std::string("Skipped Remove Grain. It crashes After Effects, so we leave it alone. 6 effects need "
                       "their own window or layer. Those get learned when you use them."));
  CHECK_EQ(page.rows[0].tag, std::string("DONE"));
  CHECK_EQ(page.rows[0].status, std::string("584 of 585 effects learned"));
  CHECK_EQ(page.rows[1].tag, std::string("LATER"));
  CHECK(page.rows[1].kind == Tag::Later);
  CHECK_EQ(page.rows[1].status, std::string("didn't finish"));
  CHECK_EQ(page.bar.fraction, 1.0);
}

TEST(catalogue_nothing_learned_is_not_here_later) {
  Page page;
  CHECK(
      page.render(parsed(
          R"({"ok":true,"engine":{"state":"failed","hosts":[{"year":"2026","state":"failed","phase":"finished"}]}})")) ==
      Outcome::Finished);
  CHECK_EQ(page.heading, std::string("Not here. Later, then"));
  CHECK_EQ(page.note, std::string("None skipped. We checked."));
}

TEST(catalogue_no_hosts_is_reported_and_never_success) {
  Page page;
  CHECK(page.render(parsed(R"({"ok":true,"engine":{"state":"failed","hosts":[]}})")) == Outcome::NoHosts);
  CHECK(page.rows.empty());
}

TEST(catalogue_skipped_note_lists_three_and_counts_the_rest) {
  Host host;
  host.year = "2026";
  host.state = "done";
  host.result = HostResult{10, 6, 0, 0, 0, {"A", "B", "C", "D", "E"}};
  CHECK_EQ(skippedNote(Language::En, {host}),
           std::string("Skipped A, B, C and 2 more. They crash After Effects, so we leave them alone."));
}

TEST(catalogue_host_status_words) {
  Host host;
  host.state = "running";
  host.phase = "restarting";
  CHECK_EQ(hostStatus(Language::En, host), std::string("an effect crashed it. Restarting without it"));
  CHECK_EQ(tagWord(Language::En, host), std::string("RESTARTING"));
  host.phase = "reading-effects";
  CHECK_EQ(hostStatus(Language::En, host), std::string("listing installed effects"));
  CHECK_EQ(tagWord(Language::En, host), std::string("LISTING"));
  host.state = "failed";
  host.phase = "finished";
  host.result = HostResult{585, 500, 0, 0, 0, {}};
  CHECK_EQ(tagWord(Language::En, host), std::string("PARTLY"));
  CHECK_EQ(hostStatus(Language::En, host), std::string("500 of 585 effects learned. The rest later"));
}

TEST(catalogue_canned_statuses_walk_from_waiting_to_finished) {
  const std::vector<CannedStatus> canned = cannedStatuses();
  CHECK_EQ(canned.size(), static_cast<std::size_t>(6));
  Page page;
  for (const CannedStatus& entry : canned) {
    const Outcome outcome = page.render(entry.status);
    CHECK(outcome ==
          (entry.name.rfind("5-", 0) == 0 || entry.name.rfind("6-", 0) == 0 ? Outcome::Finished : Outcome::Running));
    if (entry.name.rfind("5-", 0) == 0) CHECK_EQ(page.heading, std::string("Your effects are learned"));
  }
  CHECK_EQ(page.rows[0].tag, std::string("LATER"));
  CHECK(page.retryable);
}

TEST(catalogue_poller_waits_for_the_session_then_gives_up) {
  Page page;
  Poller poller(page, 100);
  CHECK(poller.tick(101, false) == Poller::Next::Nothing);
  CHECK(!poller.ended());
  CHECK(poller.tick(100 + kSessionWaitSeconds + 1, false) == Poller::Next::Nothing);
  CHECK(poller.ended());
  CHECK_EQ(page.detail, std::string("extynt's helper didn't start in time."));
  CHECK_EQ(page.eyebrow, std::string("EFFECT CATALOGUE \xC2\xB7 LATER"));
  CHECK(page.bar.hidden);
  CHECK(!poller.closeDue(100 + kSessionWaitSeconds + 2));
  CHECK(poller.closeDue(100 + kSessionWaitSeconds + 1 + kSummarySeconds));
}

TEST(catalogue_poller_posts_once_then_polls_and_ends_with_the_run) {
  Page page;
  Poller poller(page, 0);
  CHECK(poller.tick(1, true) == Poller::Next::Post);
  poller.sent(Poller::Next::Post);
  CHECK(poller.tick(2, true) == Poller::Next::Nothing);
  poller.received(extynt::catalogue::parseResponse(kLearning), 2);
  CHECK(poller.tick(3, true) == Poller::Next::Get);
  poller.sent(Poller::Next::Get);
  poller.received(std::nullopt, 3);
  CHECK(!poller.ended());
  CHECK(poller.tick(4, true) == Poller::Next::Get);
  poller.sent(Poller::Next::Get);
  poller.received(extynt::catalogue::parseResponse(kFinished), 4);
  CHECK(poller.ended());
  CHECK(poller.tick(5, true) == Poller::Next::Nothing);
  CHECK(!poller.closeDue(4 + kSummarySeconds - 1));
  CHECK(poller.closeDue(4 + kSummarySeconds));
}

TEST(catalogue_poller_posts_again_after_the_sidecar_restarts) {
  Page page;
  Poller poller(page, 0);
  poller.sent(poller.tick(1, true));
  poller.received(extynt::catalogue::parseResponse(kLearning), 1);
  CHECK(poller.tick(2, true) == Poller::Next::Get);
  poller.sessionChanged();
  CHECK(poller.tick(2, true) == Poller::Next::Post);
  poller.sent(Poller::Next::Post);
  poller.received(extynt::catalogue::parseResponse(kLearning), 3);
  CHECK(poller.tick(4, true) == Poller::Next::Get);
}

TEST(catalogue_poller_keeps_its_summary_when_the_session_changes_after_the_end) {
  Page page;
  Poller poller(page, 0);
  poller.sent(poller.tick(1, true));
  poller.received(extynt::catalogue::parseResponse(kFinished), 1);
  poller.sessionChanged();
  CHECK(poller.ended());
  CHECK(poller.tick(2, true) == Poller::Next::Nothing);
}

TEST(catalogue_poller_gives_up_when_the_first_post_is_not_a_status) {
  Page page;
  Poller poller(page, 0);
  poller.sent(poller.tick(1, true));
  poller.received(std::nullopt, 1);
  CHECK(poller.ended());
  CHECK_EQ(page.detail, std::string("extynt couldn't start learning here."));
}

TEST(catalogue_poller_gives_up_without_a_supported_after_effects) {
  Page page;
  Poller poller(page, 0);
  poller.sent(poller.tick(1, true));
  poller.received(extynt::catalogue::parseResponse(R"({"ok":true,"engine":{"state":"failed","hosts":[]}})"), 1);
  CHECK(poller.ended());
  CHECK_EQ(page.detail, std::string("No supported After Effects found."));
}

namespace {

const char* const kTimedOut =
    R"({"ok":true,"engine":{"state":"failed","hosts":[{"year":"2026","state":"failed","phase":"finished","reason":"hung","result":null},)"
    R"({"year":"2025","state":"done","phase":"finished","reason":"complete","result":null}],"catalogue":{}}})";

const char* const kOpenVersion =
    R"({"ok":true,"engine":{"state":"done","hosts":[{"year":"2026","state":"failed","phase":"finished","reason":"after-effects-open","result":null},)"
    R"({"year":"2025","state":"done","phase":"finished","reason":"complete","result":null}],"catalogue":{}}})";

}

TEST(catalogue_timed_out_scan_names_its_version_and_offers_a_retry) {
  Page page;
  Poller poller(page, 0);
  poller.sent(poller.tick(1, true));
  poller.received(extynt::catalogue::parseResponse(kTimedOut), 1);
  CHECK(poller.ended());
  CHECK(page.retryable);
  CHECK_EQ(page.footnote, std::string("After Effects 2026 timed out."));
  CHECK_EQ(page.heading, std::string("Learning didn't finish"));
  CHECK_EQ(page.note, std::string("Your existing catalogue is still used."));
  CHECK(!poller.closeDue(1 + kSummarySeconds + 1));
  poller.retry();
  CHECK(!poller.ended());
  CHECK(!page.retryable);
  CHECK(page.footnote.empty());
  CHECK(poller.tick(2, true) == Poller::Next::Post);
  poller.sent(Poller::Next::Post);
  poller.received(extynt::catalogue::parseResponse(kLearning), 3);
  CHECK(page.footnote.empty());
  CHECK(!page.retryable);
}

namespace {

Host failedHost(const char* reason) {
  Host host;
  host.year = "2026";
  host.state = "failed";
  host.phase = "finished";
  host.reason = reason;
  return host;
}

}

TEST(catalogue_every_failed_end_reason_has_honest_words_and_a_retry) {
  const std::vector<std::pair<std::string, std::string>> reasons = {{"hung", "timed out"},
                                                                    {"stalled", "timed out"},
                                                                    {"time-limit", "timed out"},
                                                                    {"start-failed", "didn't start"},
                                                                    {"census-failed", "didn't answer"},
                                                                    {"modal-blocked", "is blocked"},
                                                                    {"crashed", "kept crashing"},
                                                                    {"paused:no-session", "paused"}};
  for (const auto& [reason, phrase] : reasons) {
    Page page;
    const Status status{"failed", {failedHost(reason.c_str())}, Live{}};
    CHECK(page.render(status) == Outcome::Finished);
    CHECK(page.retryable);
    CHECK_EQ(page.footnote, "After Effects 2026 " + phrase + ".");
    CHECK_EQ(page.heading, std::string("Learning didn't finish"));
    CHECK_EQ(page.rows[0].status, phrase);
  }
}

TEST(catalogue_failed_scan_beside_a_learned_one_never_says_learned) {
  Page page;
  Host learned = failedHost("complete");
  learned.year = "2025";
  learned.state = "done";
  learned.result = HostResult{443, 436, 0, 0, 0, {}};
  CHECK(page.render(Status{"failed", {failedHost("census-failed"), learned}, Live{}}) == Outcome::Finished);
  CHECK_EQ(page.heading, std::string("Learning didn't finish"));
  CHECK(page.retryable);
  CHECK_EQ(page.footnote, std::string("After Effects 2026 didn't answer."));
}

TEST(catalogue_blocked_by_a_dialog_says_to_close_it) {
  Page page;
  page.render(Status{"failed", {failedHost("modal-blocked")}, Live{}});
  CHECK_EQ(
      page.note,
      std::string("Close the dialog After Effects is showing, then retry. Your existing catalogue is still used."));
}

TEST(catalogue_open_version_footer_says_restart_and_offers_no_retry) {
  Page page;
  Poller poller(page, 0);
  poller.sent(poller.tick(1, true));
  poller.received(extynt::catalogue::parseResponse(kOpenVersion), 1);
  CHECK(poller.ended());
  CHECK_EQ(page.footnote, std::string("After Effects is open: restart it to load extynt."));
  CHECK(!page.retryable);
  CHECK(poller.closeDue(1 + kSummarySeconds));
  poller.retry();
  CHECK(poller.ended());
}

TEST(catalogue_clean_finish_has_no_footer) {
  Page page;
  Poller poller(page, 0);
  poller.sent(poller.tick(1, true));
  poller.received(extynt::catalogue::parseResponse(kFinished), 1);
  CHECK(page.footnote.empty());
  CHECK(!page.retryable);
}

}

// Watch sampling and change tracking: the state a sample holds, the lines a tracker emits, the epoch and the bounds.
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>

#include "executor.h"
#include "fake_host.h"
#include "json_probe.h"
#include "request.h"
#include "testing.h"
#include "watch.h"

using namespace extynt;

namespace {

JsonValue parsed(const std::string& text) {
  JsonValue value;
  std::string error;
  if (!parseJson(text, value, error)) throw testing::Failure{"bad JSON: " + error + "\n" + text};
  return value;
}

const JsonValue& at(const JsonValue& value, const char* key) {
  const JsonValue* found = value.find(key);
  if (!found) throw testing::Failure{std::string("missing key ") + key};
  return *found;
}

std::string reasons(const JsonValue& line) {
  std::string out;
  for (const JsonValue& item : at(line, "reason").items) out += (out.empty() ? "" : ",") + item.text;
  return out;
}

JsonValue emitted(const std::optional<std::string>& line) {
  if (!line) throw testing::Failure{"expected a line"};
  return parsed(*line);
}

TEST(a_sample_holds_the_project_the_active_comp_and_the_named_selection) {
  fake::Host host = fake::makeScene();
  const WatchSample sample = sampleWatch(host, nullptr);
  CHECK(sample.hasProject);
  CHECK_EQ(sample.projectName, std::string("Test Project.aep"));
  CHECK_EQ(testing::need(sample.projectPath, "projectPath"), std::string("/tmp/Test Project.aep"));
  CHECK_EQ(testing::need(sample.revision, "revision"), int64_t(9264));
  CHECK_EQ(testing::need(sample.items, "items"), int64_t(4));
  CHECK_EQ(testing::need(sample.activeCompId, "activeCompId"), std::string("2"));
  CHECK_EQ(testing::need(sample.activeCompName, "activeCompName"), std::string("Main"));
  CHECK_EQ(testing::need(sample.time, "time"), 1.5);
  CHECK_EQ(sample.selection.size(), size_t(1));
  CHECK_EQ(sample.selectedLayers.size(), size_t(1));
  CHECK_EQ(sample.selectedLayers[0].id, std::string("10"));
  CHECK_EQ(sample.selectedLayers[0].index, int64_t(1));
  CHECK_EQ(sample.selectedLayers[0].name, std::string("Shape A"));
}

TEST(a_sample_with_the_revision_guard_off_carries_no_revision_and_never_reads_it) {
  fake::Host host = fake::makeScene();
  host.revisionGuardOn = false;
  const WatchSample sample = sampleWatch(host, nullptr);
  CHECK(sample.hasProject);
  CHECK(!sample.revision.has_value());
  for (const std::string& script : host.scripts) CHECK(script != kRevisionScript);
}

TEST(no_project_is_an_empty_state_and_an_unreadable_revision_is_null) {
  fake::Host host = fake::makeScene();
  host.noProject = true;
  const WatchSample none = sampleWatch(host, nullptr);
  CHECK(!none.hasProject);
  const fake::Exec exec;
  const JsonValue state = parsed(exec.watch.stateJson(none));
  CHECK_EQ(at(state, "projectName").text, std::string(""));
  CHECK(at(state, "revision").isNull());
  CHECK(at(state, "items").isNull());
  CHECK(at(state, "projectPath").isNull());
  CHECK(at(state, "activeCompId").isNull());
  CHECK(at(state, "activeCompName").isNull());
  CHECK(at(state, "time").isNull());
  CHECK(at(state, "selection").items.empty());
  CHECK(at(state, "selectedLayers").items.empty());

  fake::Host noRevision = fake::makeScene();
  noRevision.revisionFails = true;
  const WatchSample partial = sampleWatch(noRevision, nullptr);
  CHECK(partial.hasProject);
  CHECK(!partial.revision.has_value());
}

TEST(watch_state_is_the_change_body_without_event_seq_or_reason) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  const ParsedRequest request = parseRequest(R"({"id":"w","op":"watch_state"})");
  const JsonValue reply = parsed(executeRequest(request.request, host, exec.context(), 0));
  const JsonValue& result = at(reply, "result");
  CHECK_EQ(at(result, "epoch").number, 1.0);
  CHECK_EQ(at(result, "revision").number, 9264.0);
  CHECK_EQ(at(result, "items").number, 4.0);
  CHECK_EQ(at(result, "activeCompName").text, std::string("Main"));
  CHECK_EQ(at(at(result, "selectedLayers").items[0], "name").text, std::string("Shape A"));
  CHECK(result.find("event") == nullptr);
  CHECK(result.find("seq") == nullptr);
  CHECK(result.find("reason") == nullptr);
  CHECK(result.find("at") == nullptr);
}

TEST(the_first_observation_is_an_initial_change_then_quiet_then_a_still_line) {
  fake::Host host = fake::makeScene();
  WatchTracker tracker;
  tracker.requestInitial();
  const JsonValue first = emitted(tracker.observe(tracker.take(host), 1000.0, 1000));
  CHECK_EQ(at(first, "event").text, std::string("change"));
  CHECK_EQ(at(first, "seq").number, 1.0);
  CHECK_EQ(at(first, "at").number, 1000.0);
  CHECK_EQ(at(first, "epoch").number, 1.0);
  CHECK_EQ(reasons(first), std::string("initial"));
  CHECK_EQ(at(first, "revision").number, 9264.0);

  CHECK(!tracker.observe(tracker.take(host), 1100.0, 1000).has_value());
  CHECK(!tracker.observe(tracker.take(host), 1999.0, 1000).has_value());
  const JsonValue still = emitted(tracker.observe(tracker.take(host), 2000.0, 1000));
  CHECK_EQ(at(still, "event").text, std::string("still"));
  CHECK_EQ(at(still, "seq").number, 2.0);
  CHECK_EQ(at(still, "epoch").number, 1.0);
  CHECK_EQ(at(still, "revision").number, 9264.0);
  CHECK(!tracker.observe(tracker.take(host), 2500.0, 1000).has_value());
  CHECK(emitted(tracker.observe(tracker.take(host), 3000.0, 1000)).find("event") != nullptr);

  tracker.requestInitial();
  const JsonValue again = emitted(tracker.observe(tracker.take(host), 3100.0, 1000));
  CHECK_EQ(reasons(again), std::string("initial"));
  CHECK_EQ(at(again, "seq").number, 4.0);
}

TEST(a_change_lists_exactly_what_differs) {
  fake::Host host = fake::makeScene();
  WatchTracker tracker;
  tracker.observe(tracker.take(host), 0.0, 1000);
  host.revision = 9265;
  CHECK_EQ(reasons(emitted(tracker.observe(tracker.take(host), 100.0, 1000))), std::string("revision"));
  host.comps[0].selected = {"11"};
  CHECK_EQ(reasons(emitted(tracker.observe(tracker.take(host), 200.0, 1000))), std::string("selection"));
  host.comps[0].row.currentTime = 2.25;
  const JsonValue timeLine = emitted(tracker.observe(tracker.take(host), 300.0, 1000));
  CHECK_EQ(reasons(timeLine), std::string("time"));
  CHECK_EQ(at(timeLine, "time").number, 2.25);
  CHECK_EQ(at(at(timeLine, "selectedLayers").items[0], "name").text, std::string("Null B"));
  host.projectInfo.activeCompId = std::string("3");
  CHECK_EQ(reasons(emitted(tracker.observe(tracker.take(host), 400.0, 1000))), std::string("active,selection,time"));
  host.projectInfo.name = "Renamed.aep";
  const JsonValue project = emitted(tracker.observe(tracker.take(host), 500.0, 1000));
  CHECK_EQ(reasons(project), std::string("project"));
  CHECK_EQ(at(project, "projectName").text, std::string("Renamed.aep"));
  CHECK_EQ(at(project, "epoch").number, 2.0);
}

TEST(the_item_count_and_layer_names_are_read_again_only_when_needed) {
  fake::Host host = fake::makeScene();
  WatchTracker tracker;
  tracker.take(host);
  host.itemRows.pop_back();
  host.comps[0].layers[0].row.name = "Renamed";
  CHECK_EQ(testing::need(tracker.take(host).items, "items"), int64_t(4));
  CHECK_EQ(tracker.take(host).selectedLayers[0].name, std::string("Shape A"));
  host.revision = 9265;
  const WatchSample after = tracker.take(host);
  CHECK_EQ(testing::need(after.items, "items"), int64_t(3));
  CHECK_EQ(after.selectedLayers[0].name, std::string("Renamed"));
}

TEST(the_epoch_moves_on_a_new_project_or_a_falling_revision_but_not_on_edits) {
  fake::Host host = fake::makeScene();
  WatchTracker tracker;
  CHECK_EQ(tracker.probeEpoch(host), int64_t(1));
  host.revision = 9300;
  CHECK_EQ(tracker.take(host).revision.value_or(0), int64_t(9300));
  CHECK_EQ(tracker.epoch(), int64_t(1));
  host.revision = 100;
  tracker.take(host);
  CHECK_EQ(tracker.epoch(), int64_t(2));
  host.projectInfo.filePath = std::nullopt;
  tracker.take(host);
  CHECK_EQ(tracker.epoch(), int64_t(3));
  host.revision = 5;
  tracker.take(host);
  CHECK_EQ(tracker.epoch(), int64_t(4));
  host.revisionFails = true;
  tracker.take(host);
  CHECK_EQ(tracker.epoch(), int64_t(4));
}

TEST(selection_and_names_are_bounded) {
  fake::Host host = fake::makeScene();
  fake::Comp& comp = host.comps[0];
  const fake::Layer proto = comp.layers[0];
  comp.layers.clear();
  comp.selected.clear();
  for (int i = 1; i <= 300; ++i) {
    fake::Layer layer = proto;
    layer.row.id = std::to_string(1000 + i);
    layer.row.index = i;
    layer.row.name = std::string(126, 'a') + "\xC3\xA9\xC3\xA9";
    comp.layers.push_back(layer);
    comp.selected.push_back(layer.row.id);
  }
  const WatchSample sample = sampleWatch(host, nullptr);
  CHECK_EQ(sample.selection.size(), kWatchMaxSelection);
  CHECK_EQ(sample.selectedLayers.size(), kWatchMaxNamedLayers);
  CHECK_EQ(sample.selectedLayers[0].name.size(), size_t(128));
  CHECK_EQ(sample.selectedLayers[0].name.substr(126), std::string("\xC3\xA9"));
}

TEST(the_host_closing_line_carries_the_next_seq) {
  WatchTracker tracker;
  const JsonValue line = parsed(tracker.hostClosingLine(5000.5));
  CHECK_EQ(at(line, "event").text, std::string("host-closing"));
  CHECK_EQ(at(line, "seq").number, 1.0);
  CHECK_EQ(at(line, "at").number, 5000.5);
  CHECK_EQ(at(line, "reason").text, std::string("death-hook"));
  CHECK_EQ(at(parsed(tracker.hostClosingLine(1)), "seq").number, 2.0);
}

TEST(sampling_is_paced_by_the_interval_and_an_initial_request_forces_one) {
  WatchTracker tracker;
  CHECK(tracker.claimSample(0.0, 100));
  CHECK(!tracker.sampleDue(99.0, 100));
  CHECK(!tracker.claimSample(99.0, 100));
  CHECK(tracker.sampleDue(100.0, 100));
  CHECK(tracker.claimSample(100.0, 100));
  tracker.requestInitial();
  CHECK(tracker.sampleDue(101.0, 100));
}

}

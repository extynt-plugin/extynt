// The PiPL and resource-fork readers on synthetic bytes, the scan over a fake plug-in source, and the census reply.
#include <cstddef>
#include <map>
#include <string>
#include <string_view>
#include <vector>

#include "executor.h"
#include "fake_host.h"
#include "json_probe.h"
#include "options_dialogs.h"
#include "pipl.h"
#include "request.h"
#include "pipl_builders.h"
#include "testing.h"

using namespace extynt;
using namespace pipltest;

namespace {

TEST(a_pipl_yields_the_match_name_and_the_dialog_flag_in_either_byte_order) {
  for (const bool little : {false, true}) {
    const auto withDialog = parsePipl(makePipl("ADBE Apply Color LUT2", (1U << 5) | (1U << 10), little));
    CHECK(withDialog.has_value());
    CHECK_EQ(withDialog ? withDialog->matchName : std::string(), std::string("ADBE Apply Color LUT2"));
    CHECK(withDialog.has_value() && flagsHaveOptionsDialog(withDialog->globalOutFlags));
    const auto without = parsePipl(makePipl("ADBE Blur", 1U << 10, little));
    CHECK(without.has_value());
    CHECK(without.has_value() && !flagsHaveOptionsDialog(without->globalOutFlags));
  }
}

TEST(a_malformed_pipl_yields_nothing) {
  const std::string good = makePipl("ADBE Blur", 0, false);
  CHECK(!parsePipl(""));
  CHECK(!parsePipl(good.substr(0, 11)));
  CHECK(!parsePipl(good.substr(0, good.size() - 6)));
  CHECK(parsePipl(makePipl("ADBE Blur", 0, false, 5)).has_value());
  std::string noVendor = good;
  noVendor[8] = 'X';
  CHECK(!parsePipl(noVendor));
  std::string hugeCount = good;
  hugeCount[4] = static_cast<char>(0x7F);
  CHECK(!parsePipl(hugeCount));
  CHECK(!parsePipl(makePipl(std::string("bad\x01name"), 0, false)));
  CHECK(!parsePipl(std::string(kMaxPiplBytes + 1, '\0')));
}

TEST(a_resource_fork_yields_every_resource_of_the_asked_type) {
  const std::string a = makePipl("ADBE One", 1U << 5, false);
  const std::string b = makePipl("ADBE Two", 0, false);
  const std::string fork = makeFork({{fourCC('S', 'T', 'R', ' '), {"abc"}}, {fourCC('P', 'i', 'P', 'L'), {a, b}}});
  const std::vector<std::string_view> found = forkResources(fork, fourCC('P', 'i', 'P', 'L'));
  CHECK_EQ(found.size(), size_t{2});
  CHECK_EQ(std::string(found[0]), a);
  CHECK(parsePipl(found[1]).has_value());
  CHECK(forkResources(fork, fourCC('N', 'O', 'N', 'E')).empty());
}

TEST(a_malformed_resource_fork_yields_nothing) {
  const std::string fork = makeFork({{fourCC('P', 'i', 'P', 'L'), {makePipl("ADBE One", 0, false)}}});
  CHECK(forkResources("", fourCC('P', 'i', 'P', 'L')).empty());
  CHECK(forkResources(fork.substr(0, 20), fourCC('P', 'i', 'P', 'L')).empty());
  CHECK(forkResources(fork.substr(0, fork.size() - 30), fourCC('P', 'i', 'P', 'L')).empty());
  std::string wild = fork;
  wild[4] = static_cast<char>(0x7F);
  CHECK(forkResources(wild, fourCC('P', 'i', 'P', 'L')).empty());
}

class FakeSource : public PiplSource {
 public:
  std::vector<std::string> pluginFiles() override {
    std::vector<std::string> names;
    names.reserve(files.size());
    for (const auto& [name, resources] : files) names.push_back(name);
    return names;
  }
  std::vector<std::string> readPipls(const std::string& file) override { return files[file]; }
  std::map<std::string, std::vector<std::string>> files;
};

TEST(the_scan_lists_every_effect_sorted_and_keeps_the_first_flag_of_a_repeated_name) {
  FakeSource source;
  source.files["a.aex"] = {makePipl("ADBE Numbers", 1U << 5, true), "junk"};
  source.files["b.aex"] = {makePipl("ADBE Blur", 0, true), makePipl("ADBE Numbers", 0, true)};
  source.files["c.aex"] = {};
  const std::vector<EffectDialogFlag> rows = scanOptionsDialogs(source);
  CHECK_EQ(rows.size(), size_t{2});
  CHECK_EQ(rows[0].matchName, std::string("ADBE Blur"));
  CHECK(!rows[0].hasOptionsDialog);
  CHECK_EQ(rows[1].matchName, std::string("ADBE Numbers"));
  CHECK(rows[1].hasOptionsDialog);
}

TEST(the_census_reply_carries_the_scan_when_it_is_ready_and_leaves_it_out_otherwise) {
  fake::Host host = fake::makeScene();
  host.entryAnswers["aeHostCensus"] = R"({"ok":true})";
  fake::Exec exec;
  const ParsedRequest request = parseRequest(R"({"id":"h","op":"host_call","entry":"aeHostCensus","args":"{}"})");
  CHECK(request.ok);
  const std::string before = executeRequest(request.request, host, exec.context(), 0);
  CHECK(before.find("optionsDialogScan") == std::string::npos);
  host.dialogScanPending = true;
  const std::string running = executeRequest(request.request, host, exec.context(), 0);
  CHECK(running.find("\"optionsDialogScanPending\":true") != std::string::npos);
  host.dialogScanPending = false;
  host.dialogFlags = std::vector<EffectDialogFlag>{{"ADBE Apply Color LUT2", true}, {"ADBE Blur", false}};
  JsonValue reply;
  std::string error;
  CHECK(parseJson(executeRequest(request.request, host, exec.context(), 0), reply, error));
  const JsonValue* scan = reply.find("result")->find("optionsDialogScan");
  CHECK(scan != nullptr);
  CHECK_EQ(scan->items.size(), size_t{2});
  CHECK_EQ(scan->items[0].find("matchName")->text, std::string("ADBE Apply Color LUT2"));
  CHECK(scan->items[0].find("hasOptionsDialog")->boolean);
  CHECK(!scan->items[1].find("hasOptionsDialog")->boolean);
}

}

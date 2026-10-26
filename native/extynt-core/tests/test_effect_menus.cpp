// effect_menus: the request, the popup text split, and the response.
#include <string>

#include "effect_menus.h"
#include "executor.h"
#include "fake_host.h"
#include "host_reader.h"
#include "json_probe.h"
#include "request.h"
#include "testing.h"

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

std::string run(fake::Host& host, const std::string& line) {
  fake::Exec exec;
  const ParsedRequest request = parseRequest(line);
  if (!request.ok) throw testing::Failure{"request refused: " + request.errorMessage};
  return executeRequest(request.request, host, exec.context(), 0);
}

EffectPopups glow() {
  EffectPopups effect;
  effect.matchName = "ADBE Glo2";
  effect.popups.push_back({"ADBE Glo2-0006", "None|Add|Screen", 3});
  return effect;
}

TEST(split_keeps_every_item_in_order) {
  const PopupItems split = splitPopupNames("Normal|Add|Screen", 3);
  CHECK(split.matchesCount);
  CHECK(split.items.size() == 3);
  CHECK(split.items[1] == "Add");
}

TEST(split_marks_separator_slots_and_strips_the_disabled_mark) {
  const PopupItems split = splitPopupNames("A|(-|(B|C", 4);
  CHECK(split.matchesCount);
  CHECK(split.items[1] == "-");
  CHECK(split.items[2] == "B");
}

TEST(split_reports_a_count_that_does_not_match) {
  CHECK(!splitPopupNames("A|B", 3).matchesCount);
  CHECK(splitPopupNames("A|B|", 2).matchesCount);
  CHECK(!splitPopupNames("A|B|", 4).matchesCount);
}

TEST(effect_menus_needs_comp_and_layer) {
  CHECK(!parseRequest(R"({"op":"effect_menus","compId":"2"})").ok);
  CHECK(parseRequest(R"({"op":"effect_menus","compId":"2","layerId":"10"})").ok);
}

TEST(effect_menus_answers_the_popups_of_each_effect) {
  fake::Host host = fake::makeScene();
  host.popups.push_back(glow());
  const JsonValue reply = parsed(run(host, R"({"id":"m","op":"effect_menus","compId":"2","layerId":"10"})"));
  CHECK(at(reply, "ok").boolean);
  const JsonValue& effect = at(at(reply, "result"), "effects").items.at(0);
  CHECK(at(effect, "matchName").text == "ADBE Glo2");
  const JsonValue& popup = at(effect, "popups").items.at(0);
  CHECK(at(popup, "matchName").text == "ADBE Glo2-0006");
  CHECK(at(popup, "consistent").boolean);
  CHECK(at(popup, "items").items.size() == 3);
  CHECK(at(popup, "items").items.at(2).text == "Screen");
}

TEST(effect_menus_refuses_a_missing_layer_and_a_missing_comp) {
  fake::Host host = fake::makeScene();
  CHECK(at(at(parsed(run(host, R"({"op":"effect_menus","compId":"2","layerId":"999"})")), "error"), "code").text ==
        "LAYER_NOT_FOUND");
  CHECK(at(at(parsed(run(host, R"({"op":"effect_menus","compId":"999","layerId":"10"})")), "error"), "code").text ==
        "COMP_NOT_FOUND");
}

}

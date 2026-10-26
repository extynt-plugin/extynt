// The write-path prototype: fixed script templates and apply_test / undo_test against the fake host.
#include <cmath>
#include <cstddef>
#include <string>

#include "executor.h"
#include "fake_host.h"
#include "host_reader.h"
#include "json_probe.h"
#include "request.h"
#include "testing.h"
#include "write_ops.h"

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

Request request(const std::string& line) {
  const ParsedRequest result = parseRequest(line);
  if (!result.ok) throw testing::Failure{"request refused: " + result.errorMessage};
  return result.request;
}

std::string answer(fake::Host& host, const std::string& line) {
  fake::Exec exec;
  return executeRequest(request(line), host, exec.context(), 0);
}

bool has(const std::string& text, const std::string& part) { return text.find(part) != std::string::npos; }

ScriptRun ok(double us = 250) {
  ScriptRun run;
  run.result = "OK";
  run.us = us;
  return run;
}

TEST(write_op_requests_validate_every_argument) {
  const Request apply = request(R"({"op":"apply_test","compId":229,"layerId":"55","opacity":42.5})");
  CHECK(apply.op == Op::ApplyTest);
  CHECK_EQ(apply.compId, std::string("229"));
  CHECK_EQ(apply.layerId, std::string("55"));
  CHECK_EQ(apply.opacity, 42.5);
  for (const char* bad :
       {R"({"op":"apply_test","layerId":1,"opacity":5})", R"({"op":"apply_test","compId":1,"opacity":5})",
        R"({"op":"apply_test","compId":1,"layerId":2})", R"({"op":"apply_test","compId":1,"layerId":2,"opacity":101})",
        R"({"op":"apply_test","compId":1,"layerId":2,"opacity":-1})",
        R"({"op":"apply_test","compId":1,"layerId":2,"opacity":"5"})",
        R"({"op":"apply_test","compId":"1);app.quit();(","layerId":2,"opacity":5})",
        R"({"op":"apply_test","compId":1,"layerId":"2 ","opacity":5})",
        R"({"op":"apply_test","compId":1.5,"layerId":2,"opacity":5})",
        R"({"op":"apply_test","compId":"1234567890123456","layerId":2,"opacity":5})",
        R"({"op":"undo_test","compId":1})", R"({"op":"undo_test","layerId":1})",
        R"({"op":"undo_test","compId":"x","layerId":1})"}) {
    const ParsedRequest result = parseRequest(bad);
    CHECK(!result.ok);
    CHECK_EQ(result.errorCode, std::string("BAD_REQUEST"));
  }
  CHECK(!request("{\"op\":\"undo_test\"}").hasLayerTarget);
  const Request undo = request(R"({"op":"undo_test","compId":3,"layerId":20})");
  CHECK(undo.hasLayerTarget);
  CHECK_EQ(undo.layerId, std::string("20"));
}

TEST(apply_script_is_a_fixed_template_with_only_validated_numbers) {
  const std::string script = buildApplyOpacityScript("229", "55", 50);
  CHECK(has(script, "app.project.itemByID(229)"));
  CHECK(has(script, "c.layer(i).id===55"));
  CHECK(has(script, "app.beginUndoGroup(\"extynt native apply test\")"));
  CHECK(has(script, "p.setValue(50)"));
  CHECK(has(script, "app.endUndoGroup()"));
  CHECK(has(buildApplyOpacityScript("1", "2", 12.25), "p.setValue(12.25)"));
  CHECK(has(buildApplyOpacityScript("1", "2", 0), "p.setValue(0)"));
  for (const char* bad : {"", "1a", "-1", "1;2", "1234567890123456", " 1"}) {
    bool threw = false;
    try {
      buildApplyOpacityScript(bad, "2", 5);
    } catch (const HostFailure& failure) {
      threw = failure.code() == "BAD_REQUEST";
    }
    CHECK(threw);
    threw = false;
    try {
      buildApplyOpacityScript("2", bad, 5);
    } catch (const HostFailure& failure) {
      threw = failure.code() == "BAD_REQUEST";
    }
    CHECK(threw);
  }
  for (const double bad : {-0.5, 100.5, 1e308, std::nan(""), HUGE_VAL}) {
    bool threw = false;
    try {
      buildApplyOpacityScript("1", "2", bad);
    } catch (const HostFailure&) {
      threw = true;
    }
    CHECK(threw);
  }
  CHECK(has(buildUndoScript(), "app.executeCommand(16)"));
}

TEST(js_string_escaping) {
  CHECK_EQ(escapeJsString("a\\b\"c\nd"), std::string("a\\\\b\\\"c\\x0ad"));
  CHECK_EQ(escapeJsString("/Users/Zoë/ok"), std::string("/Users/Zoë/ok"));
  CHECK_EQ(escapeJsString("a\xE2\x80\xA8z"), std::string("a\\u2028z"));
}

TEST(apply_test_runs_the_script_then_verifies_natively_in_the_same_turn) {
  fake::Host host = fake::makeScene();
  host.scriptHook = [](const std::string&, fake::Host& h) {
    h.setOpacity("3", "20", 75);
    return ok(310);
  };
  const JsonValue reply = parsed(answer(host, R"({"id":"w","op":"apply_test","compId":3,"layerId":20,"opacity":75})"));
  CHECK(at(reply, "ok").boolean);
  const JsonValue& result = at(reply, "result");
  CHECK(at(result, "applied").boolean);
  CHECK(at(result, "verified").boolean);
  CHECK_EQ(at(result, "readBack").number, 75.0);
  CHECK_EQ(at(result, "requested").number, 75.0);
  CHECK_EQ(at(result, "scriptUs").number, 310.0);
  CHECK_EQ(at(result, "scriptResult").text, std::string("OK"));
  CHECK(at(result, "verifyUs").number >= 0);
  CHECK(at(result, "totalUs").number >= at(result, "verifyUs").number);
  CHECK_EQ(host.scripts.size(), size_t(1));
  CHECK(host.scripts[0].find("itemByID(3)") != std::string::npos);
  CHECK_EQ(host.invalidations, 1);
  CHECK(host.open.empty());
}

TEST(apply_test_reports_unverified_when_the_native_read_disagrees_or_the_script_failed) {
  fake::Host stale = fake::makeScene();
  const JsonValue notVerified = parsed(answer(stale, R"({"op":"apply_test","compId":3,"layerId":20,"opacity":75})"));
  CHECK(at(at(notVerified, "result"), "applied").boolean);
  CHECK(at(at(notVerified, "result"), "verified").boolean == false);
  CHECK_EQ(at(at(notVerified, "result"), "readBack").number, 50.0);

  fake::Host failing = fake::makeScene();
  failing.scriptHook = [](const std::string&, fake::Host&) {
    ScriptRun run;
    run.result = "ERR:layer";
    run.us = 90;
    return run;
  };
  const JsonValue failed = parsed(answer(failing, R"({"op":"apply_test","compId":3,"layerId":20,"opacity":50})"));
  const JsonValue& result = at(failed, "result");
  CHECK(at(result, "applied").boolean == false);
  CHECK(at(result, "verified").boolean == false);

  fake::Host noLayer = fake::makeScene();
  noLayer.scriptHook = [](const std::string&, fake::Host&) { return ok(); };
  const JsonValue missing = parsed(answer(noLayer, R"({"op":"apply_test","compId":3,"layerId":999,"opacity":50})"));
  CHECK(at(at(missing, "result"), "readBack").isNull());
  CHECK_EQ(at(at(missing, "result"), "readError").text, std::string("LAYER_NOT_FOUND"));
  CHECK(at(at(missing, "result"), "verified").boolean == false);

  fake::Host scriptError = fake::makeScene();
  scriptError.scriptHook = [](const std::string&, fake::Host&) {
    ScriptRun run;
    run.error = "AEGP_ExecuteScript failed (AEGP error 5)";
    return run;
  };
  const JsonValue broke = parsed(answer(scriptError, R"({"op":"apply_test","compId":3,"layerId":20,"opacity":50})"));
  CHECK_EQ(at(at(broke, "result"), "scriptError").text, std::string("AEGP_ExecuteScript failed (AEGP error 5)"));
  CHECK(at(at(broke, "result"), "applied").boolean == false);
}

TEST(undo_test_runs_edit_undo_and_optionally_reads_the_opacity_back) {
  fake::Host host = fake::makeScene();
  host.scriptHook = [](const std::string& script, fake::Host& h) {
    if (script.find("executeCommand(16)") != std::string::npos) h.setOpacity("3", "20", 50);
    return ok(120);
  };
  host.setOpacity("3", "20", 75);
  const JsonValue bare = parsed(answer(host, R"({"op":"undo_test"})"));
  CHECK(at(at(bare, "result"), "applied").boolean);
  CHECK_EQ(at(at(bare, "result"), "scriptUs").number, 120.0);
  CHECK(at(bare, "result").find("readBack") == nullptr);
  host.setOpacity("3", "20", 75);
  const JsonValue withRead = parsed(answer(host, R"({"op":"undo_test","compId":3,"layerId":20})"));
  CHECK_EQ(at(at(withRead, "result"), "readBack").number, 50.0);
  CHECK(at(at(withRead, "result"), "verifyUs").number >= 0);
  CHECK_EQ(host.scripts.size(), size_t(2));
  CHECK_EQ(host.scripts[0], buildUndoScript());
}

}

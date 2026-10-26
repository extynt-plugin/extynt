// The batch op: several main-thread ops in one idle turn.
#include <string>
#include <cstddef>
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

std::string run(fake::Host& host, const std::string& line, double queuedMs = 0) {
  const ParsedRequest parsedRequest = parseRequest(line);
  if (!parsedRequest.ok) throw testing::Failure{"request refused: " + parsedRequest.errorMessage};
  fake::Exec exec;
  return executeRequest(parsedRequest.request, host, exec.context(), queuedMs);
}

TEST(batch_parses_its_ops_and_refuses_nesting_and_ping_direct) {
  ParsedRequest ok =
      parseRequest(R"({"op":"batch","ops":[{"op":"ping"},{"op":"read_comp","compId":"2"},{"op":"revision"}]})");
  CHECK(ok.ok);
  CHECK_EQ(ok.request.batch.size(), size_t(3));
  CHECK(ok.request.batch[1].op == Op::ReadComp);
  CHECK_EQ(ok.request.batch[1].compId, std::string("2"));
  CHECK(!ok.request.stopOnError);
  CHECK(parseRequest("{\"op\":\"batch\",\"stopOnError\":true,\"ops\":[{\"op\":\"ping\"}]}").request.stopOnError);

  const ParsedRequest nested = parseRequest(R"({"op":"batch","ops":[{"op":"batch","ops":[{"op":"ping"}]}]})");
  CHECK(!nested.ok);
  CHECK_EQ(nested.errorCode, std::string("BAD_REQUEST"));
  CHECK(nested.errorMessage.find("nested") != std::string::npos);
  const ParsedRequest direct = parseRequest(R"({"op":"batch","ops":[{"op":"ping"},{"op":"ping_direct"}]})");
  CHECK(!direct.ok);
  CHECK(direct.errorMessage.find("ops[1]") != std::string::npos);
  CHECK(direct.errorMessage.find("ping_direct") != std::string::npos);
  const ParsedRequest unknown = parseRequest(R"({"op":"batch","ops":[{"op":"nope"}]})");
  CHECK_EQ(unknown.errorCode, std::string("UNKNOWN_OP"));
  const ParsedRequest badInner = parseRequest(R"({"op":"batch","ops":[{"op":"read_comp"}]})");
  CHECK_EQ(badInner.errorCode, std::string("BAD_REQUEST"));
  CHECK(badInner.errorMessage.find("ops[0]") != std::string::npos);
  for (const char* bad : {R"({"op":"batch"})", R"({"op":"batch","ops":[]})", R"({"op":"batch","ops":"ping"})",
                          R"({"op":"batch","ops":[5]})", R"({"op":"batch","stopOnError":1,"ops":[{"op":"ping"}]})"}) {
    CHECK(!parseRequest(bad).ok);
  }
  const ParsedRequest refusedWithId = parseRequest(R"({"id":"q","op":"batch","ops":[{"op":"ping_direct"}]})");
  CHECK(!refusedWithId.ok);
  CHECK_EQ(refusedWithId.request.id, std::string("q"));
  CHECK_EQ(refusedWithId.request.opName, std::string("batch"));
  CHECK_EQ(parseRequest("{\"op\":\"batch\",\"token\":\"t\",\"ops\":[{\"op\":\"ping\",\"token\":\"x\"}]}")
               .request.batch[0]
               .token,
           std::string());
  std::string many = R"({"op":"batch","ops":[)";
  for (int i = 0; i < 65; ++i) many += std::string((i != 0) ? "," : "") + R"({"op":"ping"})";
  CHECK(!parseRequest(many + "]}").ok);
}

void checkBatchTiming(const JsonValue& root, const JsonValue& results) {
  double sum = 0;
  for (const JsonValue& item : results.items) {
    CHECK(at(item, "ok").boolean);
    CHECK(at(item, "mainThreadMs").number >= 0);
    CHECK(at(item, "getterCalls").number >= 1);
    sum += at(item, "getterCalls").number;
  }
  CHECK_EQ(at(at(root, "timing"), "getterCalls").number, sum);
  CHECK_EQ(at(at(root, "timing"), "dispatchedBy").text, std::string("idle"));
}

TEST(batch_runs_every_op_in_one_turn_with_per_op_results) {
  fake::Host host = fake::makeScene();
  host.scriptHook = [](const std::string&, fake::Host& h) {
    h.setOpacity("3", "20", 60);
    ScriptRun run;
    run.result = "OK";
    run.us = 200;
    return run;
  };
  const std::string reply = run(host,
                                "{\"id\":\"b\",\"op\":\"batch\",\"ops\":["
                                "{\"id\":\"1\",\"op\":\"apply_test\",\"compId\":3,\"layerId\":20,\"opacity\":60},"
                                "{\"id\":\"2\",\"op\":\"read_paths\",\"targets\":[{\"compId\":3,\"layerId\":20,"
                                "\"path\":\"ADBE Transform Group/ADBE Opacity\"}]},"
                                "{\"id\":\"3\",\"op\":\"revision\"},"
                                "{\"id\":\"4\",\"op\":\"hash_project\"}]}");
  const JsonValue root = parsed(reply);
  CHECK(at(root, "ok").boolean);
  CHECK_EQ(at(root, "op").text, std::string("batch"));
  const JsonValue& result = at(root, "result");
  const JsonValue& results = at(result, "results");
  CHECK_EQ(results.items.size(), size_t(4));
  CHECK_EQ(at(result, "ran").number, 4.0);
  CHECK_EQ(at(result, "failed").number, 0.0);
  CHECK(at(result, "totalMainThreadMs").number >= 0);
  CHECK_EQ(at(results.items[0], "op").text, std::string("apply_test"));
  CHECK_EQ(at(results.items[0], "id").text, std::string("1"));
  CHECK(at(at(results.items[0], "result"), "verified").boolean);
  const JsonValue& entry = at(at(results.items[1], "result"), "results").items[0];
  CHECK_EQ(at(at(entry, "entry"), "value").number, 60.0);
  CHECK_EQ(at(at(results.items[2], "result"), "revision").number, 42.0);
  CHECK_EQ(at(at(results.items[3], "result"), "algorithm").text, std::string("xxh3-128"));
  CHECK_EQ(host.beginRequests, 5);
  checkBatchTiming(root, results);
  CHECK(host.open.empty());
}

TEST(a_failing_op_is_reported_and_the_rest_still_run_unless_stop_on_error) {
  fake::Host host = fake::makeScene();
  const std::string ops = R"([{"op":"read_comp","compId":"404"},{"op":"revision"},{"op":"ping"}])";
  const JsonValue all = parsed(run(host, R"({"op":"batch","ops":)" + ops + "}"));
  CHECK(at(all, "ok").boolean);
  const JsonValue& result = at(all, "result");
  CHECK_EQ(at(result, "ran").number, 3.0);
  CHECK_EQ(at(result, "failed").number, 1.0);
  const JsonValue& first = at(result, "results").items[0];
  CHECK(at(first, "ok").boolean == false);
  CHECK_EQ(at(at(first, "error"), "code").text, std::string("COMP_NOT_FOUND"));
  CHECK(at(at(result, "results").items[2], "ok").boolean);

  const JsonValue stopped = parsed(run(host, R"({"op":"batch","stopOnError":true,"ops":)" + ops + "}"));
  CHECK_EQ(at(at(stopped, "result"), "ran").number, 1.0);
  CHECK_EQ(at(at(stopped, "result"), "requested").number, 3.0);
  CHECK_EQ(at(at(stopped, "result"), "results").items.size(), size_t(1));
}

TEST(a_batch_of_reads_matches_the_same_reads_sent_alone) {
  fake::Host host = fake::makeScene();
  const JsonValue batch = parsed(run(host, R"({"op":"batch","ops":[{"op":"read_comp","compId":"2","hashes":true}]})"));
  const JsonValue alone = parsed(run(host, R"({"op":"read_comp","compId":"2","hashes":true})"));
  const JsonValue& inner = at(at(at(at(batch, "result"), "results").items[0], "result"), "compositions").items[0];
  const JsonValue& direct = at(at(alone, "result"), "compositions").items[0];
  CHECK_EQ(at(inner, "hash").text, at(direct, "hash").text);
}

}

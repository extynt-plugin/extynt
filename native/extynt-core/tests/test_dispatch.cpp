// The removed dispatch experiments, the revision op, dispatchedBy and the server's own pid.
#include <unistd.h>

#include <cstdint>
#include <string>

#include "executor.h"
#include "fake_host.h"
#include "json_probe.h"
#include "request.h"
#include "net.h"
#include "server.h"
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

Request request(const std::string& line) {
  const ParsedRequest result = parseRequest(line);
  if (!result.ok) throw testing::Failure{"request refused: " + result.errorMessage};
  return result.request;
}

TEST(the_dispatch_experiments_are_gone) {
  for (const char* line : {R"({"op":"configure"})", R"({"op":"configure","dispatch":"runloop","hotSleepTicks":1})"}) {
    const ParsedRequest refused = parseRequest(line);
    CHECK(!refused.ok);
    CHECK_EQ(refused.errorCode, std::string("UNKNOWN_OP"));
  }
}

TEST(ping_direct_answers_on_the_socket_thread_with_the_servers_own_pid) {
  const ServerConfig config;
  Server server(config);
  std::string start;
  CHECK(server.start(start));
  net::Handle fd = net::kInvalidHandle;
  std::string connectError;
  CHECK(net::connectLoopback(server.port(), fd, connectError));
  std::string line = R"({"id":"c","token":")" + server.token() + "\",\"op\":\"ping_direct\"}\n";
  CHECK(net::sendAll(fd, line.data(), line.size()));
  std::string reply;
  char c = 0;
  while (net::receiveSome(fd, &c, 1) == 1 && c != '\n') reply += c;
  const JsonValue direct = parsed(reply);
  CHECK_EQ(at(at(direct, "timing"), "dispatchedBy").text, std::string("socket"));
  CHECK(at(at(direct, "result"), "mainThread").boolean == false);
  CHECK_EQ(at(at(direct, "result"), "pid").number, static_cast<double>(::getpid()));
  CHECK_EQ(server.info().pid, static_cast<int64_t>(::getpid()));
  net::closeHandle(fd);
  server.stop();
}

TEST(executor_reports_idle_as_the_dispatch_path) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  const JsonValue idle = parsed(executeRequest(request(R"({"op":"ping"})"), host, exec.context(), 0));
  CHECK_EQ(at(at(idle, "timing"), "dispatchedBy").text, std::string("idle"));
  const JsonValue failed =
      parsed(executeRequest(request(R"({"op":"read_comp","compId":"404"})"), host, exec.context(), 0));
  CHECK(at(failed, "ok").boolean == false);
}

TEST(revision_op_with_the_guard_off_answers_null_and_never_runs_the_script) {
  fake::Host host = fake::makeScene();
  host.revisionGuardOn = false;
  fake::Exec exec;
  const JsonValue answer = parsed(executeRequest(request(R"({"id":"v","op":"revision"})"), host, exec.context(), 0));
  CHECK(at(answer, "ok").boolean);
  CHECK(at(at(answer, "result"), "revision").isNull());
  CHECK(at(at(answer, "result"), "error").text.find("guard is off") != std::string::npos);
  CHECK_EQ(host.calls, uint64_t(0));
}

TEST(revision_op_returns_both_script_costs) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  const JsonValue answer = parsed(executeRequest(request(R"({"id":"v","op":"revision"})"), host, exec.context(), 0));
  CHECK(at(answer, "ok").boolean);
  const JsonValue& result = at(answer, "result");
  CHECK_EQ(at(result, "revision").number, 42.0);
  CHECK_EQ(at(result, "revisionUs").number, 1500.0);
  CHECK_EQ(at(result, "floorUs").number, 400.0);
  CHECK_EQ(at(result, "revisionRaw").text, std::string("42"));
  CHECK(result.find("error") == nullptr);

  host.scriptCost.revision.reset();
  host.scriptCost.revisionRaw = "undefined";
  host.scriptCost.error = "Error 21: undefined is not an object";
  const JsonValue broken = parsed(executeRequest(request(R"({"op":"revision"})"), host, exec.context(), 0));
  CHECK(at(at(broken, "result"), "revision").isNull());
  CHECK_EQ(at(at(broken, "result"), "error").text, std::string("Error 21: undefined is not an object"));
  CHECK(request("{\"op\":\"revision\",\"script\":\"app.quit()\"}").op == Op::Revision);
}

}

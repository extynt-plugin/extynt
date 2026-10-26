// The headless render engine is told apart from the After Effects the user works in, and its discovery file never
// collides with the user's.
#include <string>
#include <vector>

#include "discovery.h"
#include "host_entries.h"
#include "host_mode.h"
#include "request.h"
#include "testing.h"

using namespace extynt;

namespace {

const char* const kMacApp = "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app";

TEST(only_the_explicit_engine_flag_makes_a_host_headless) {
  CHECK(headlessHost({"After Effects", "-noui", "-extynt_engine"}));
  CHECK(headlessHost({"AfterFX.exe", "-EXTYNT_ENGINE"}));
}

TEST(aerender_and_a_plain_noui_session_are_not_the_engine) {
  CHECK(!headlessHost({"aerendercore"}));
  CHECK(!headlessHost({"After Effects", "-noui"}));
  CHECK(!headlessHost({"AfterFX.exe", "-NOUI", "-r", "x.jsx"}));
}

TEST(the_users_after_effects_is_not_headless) {
  CHECK(!headlessHost({"After Effects"}));
  CHECK(!headlessHost({"After Effects", "-re"}));
  CHECK(!headlessHost({}));
  CHECK(!headlessHost({"After Effects", "/tmp/-extynt_engine.aep"}));
}

TEST(only_the_launch_value_of_the_engine_variable_makes_a_host_headless) {
  CHECK(engineEnvironment("1"));
  CHECK(!engineEnvironment(""));
  CHECK(!engineEnvironment("0"));
  CHECK(!engineEnvironment("true"));
  CHECK(!engineEnvironment("1 "));
}

std::string quoted(const std::string& text) {
  std::string out = "\"";
  for (const char c : text) {
    if (c == '"' || c == '\\') out += '\\';
    out += c;
  }
  return out + "\"";
}

Request hostCall(const std::string& entry, const std::string& args) {
  const ParsedRequest parsed =
      parseRequest(R"({"op":"host_call","entry":")" + entry + R"(","args":)" + quoted(args) + "}");
  CHECK(parsed.ok);
  return parsed.request;
}

Request probe(const std::string& args) { return hostCall("aeCatalogueProbePage", args); }

TEST(a_probe_that_claims_the_engine_is_recognised) {
  CHECK(claimsEngineProbe(probe(R"({"engine":true,"matchNames":[]})")));
  CHECK(!claimsEngineProbe(probe(R"({"engine":false})")));
  CHECK(!claimsEngineProbe(probe(R"({"engine":"true"})")));
  CHECK(!claimsEngineProbe(probe(R"({"matchNames":[]})")));
  CHECK(!claimsEngineProbe(hostCall("aeCatalogueReadInstance", R"({"engine":true})")));
  Request batch;
  batch.op = Op::Batch;
  batch.batch = {Request{}, probe(R"({"engine":true})")};
  CHECK(claimsEngineProbe(batch));
}

Request requestFor(Op op, HostEntry entry = HostEntry::UndoPlan) {
  Request request;
  request.op = op;
  request.entry = entry;
  return request;
}

TEST(the_engine_allows_the_open_set_and_the_catalogue_calls_only) {
  CHECK(engineRequestAllowed(requestFor(Op::Ping)));
  CHECK(engineRequestAllowed(requestFor(Op::PingDirect)));
  CHECK(engineRequestAllowed(requestFor(Op::HostCall, HostEntry::HostCensus)));
  CHECK(engineRequestAllowed(requestFor(Op::HostCall, HostEntry::CatalogueProbePage)));
  CHECK(engineRequestAllowed(requestFor(Op::HostCall, HostEntry::CatalogueReadInstance)));
  CHECK(!engineRequestAllowed(requestFor(Op::HostCall, HostEntry::ApplyPlan)));
  CHECK(!engineRequestAllowed(requestFor(Op::HostCall, HostEntry::CollectIndexPage)));
  CHECK(!engineRequestAllowed(requestFor(Op::ReadProject)));
  CHECK(!engineRequestAllowed(requestFor(Op::EffectMenus)));
}

TEST(an_engine_batch_qualifies_only_when_every_item_does) {
  Request batch = requestFor(Op::Batch);
  batch.batch = {requestFor(Op::Ping), requestFor(Op::HostCall, HostEntry::HostCensus)};
  CHECK(engineRequestAllowed(batch));
  batch.batch.push_back(requestFor(Op::HostCall, HostEntry::ApplyPlan));
  CHECK(!engineRequestAllowed(batch));
}

TEST(the_engine_bundle_resolves_to_the_after_effects_app) {
  CHECK_EQ(outerAppBundle(std::string(kMacApp) + "/Contents/aerendercore.app"), std::string(kMacApp));
  CHECK_EQ(outerAppBundle(kMacApp), std::string(kMacApp));
  CHECK_EQ(outerAppBundle(std::string(kMacApp) + "/Contents/"), std::string(kMacApp) + "/Contents/");
  CHECK_EQ(outerAppBundle(""), std::string());
}

TEST(the_engine_publishes_its_own_discovery_file) {
  CHECK_EQ(discoveryFileName(false), std::string("native.json"));
  CHECK_EQ(discoveryFileName(true), std::string("native-engine.json"));
}

}

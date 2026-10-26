// Host version parsing and the `host` object in both pings: the AE 25 and AE 26 branches run here, on any machine.
#include <fstream>
#include <sstream>
#include <string>

#include "executor.h"
#include "fake_host.h"
#include "host_version.h"
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

HostApiFacts facts(bool utf16, bool complete = true) {
  HostApiFacts out;
  out.aegpApiMajor = 1;
  out.aegpApiMinor = 9;
  out.streamSuite = utf16 ? 10 : 9;
  out.expressionUtf16 = utf16;
  out.suitesComplete = complete;
  return out;
}

TEST(version_text_parses_in_every_form_the_hosts_give) {
  const HostVersion plugin = parseHostVersion("26.5.0 (build 61)");
  CHECK(plugin.known);
  CHECK_EQ(plugin.major, 26);
  CHECK_EQ(plugin.minor, 5);
  CHECK_EQ(plugin.patch, 0);
  CHECK_EQ(plugin.build, std::string("61"));
  const HostVersion script = parseHostVersion("25.6.2x14");
  CHECK_EQ(script.major, 25);
  CHECK_EQ(script.patch, 2);
  CHECK_EQ(script.build, std::string("14"));
  const HostVersion bare = parseHostVersion("  25.0");
  CHECK(bare.known);
  CHECK_EQ(bare.minor, 0);
  CHECK_EQ(bare.build, std::string(""));
}

TEST(unreadable_version_text_is_unknown_not_a_guess) {
  for (const char* text :
       {"", "unknown", "26", "26.", "x.5", "fake-host", "26.5.x", "26.5abc", "26.5.0-beta", "26.5.0.1"}) {
    CHECK(!parseHostVersion(text).known);
  }
  CHECK_EQ(std::string(hostFamilyName(hostFamily(parseHostVersion("unknown")))), std::string("unknown"));
  CHECK_EQ(std::string(svgImportRoute(parseHostVersion("unknown"))), std::string("unknown"));
}

TEST(family_and_svg_route_split_at_26) {
  CHECK_EQ(std::string(hostFamilyName(hostFamily(parseHostVersion("24.6.0")))), std::string("older"));
  CHECK_EQ(std::string(hostFamilyName(hostFamily(parseHostVersion("25.0")))), std::string("ae25"));
  CHECK_EQ(std::string(hostFamilyName(hostFamily(parseHostVersion("25.6.3")))), std::string("ae25"));
  CHECK_EQ(std::string(hostFamilyName(hostFamily(parseHostVersion("26.0")))), std::string("ae26"));
  CHECK_EQ(std::string(hostFamilyName(hostFamily(parseHostVersion("27.1")))), std::string("newer"));
  CHECK_EQ(std::string(svgImportRoute(parseHostVersion("25.6"))), std::string("converter"));
  CHECK_EQ(std::string(svgImportRoute(parseHostVersion("26.2.1"))), std::string("native"));
  CHECK_EQ(std::string(svgImportRoute(parseHostVersion("24.0"))), std::string("converter"));
}

TEST(ae25_profile_is_supported_but_not_measured_and_says_so) {
  const JsonValue host = parsed(hostProfileJson("25.6.0 (build 41)", facts(true)));
  CHECK_EQ(at(host, "family").text, std::string("ae25"));
  CHECK(at(host, "supported").boolean);
  CHECK(!at(host, "measured").boolean);
  CHECK_EQ(at(host, "major").number, 25.0);
  CHECK_EQ(at(host, "build").text, std::string("41"));
  CHECK_EQ(at(host, "aegpApi").text, std::string("1.9"));
  CHECK_EQ(at(at(host, "capabilities"), "svgImport").text, std::string("converter"));
  CHECK_EQ(at(at(host, "capabilities"), "expressionText").text, std::string("utf16"));
}

TEST(only_a_release_newer_than_the_measured_one_is_experimental) {
  CHECK(hostExperimental(parseHostVersion("27.0")));
  CHECK(hostExperimental(parseHostVersion("30.2.1")));
  CHECK(!hostExperimental(parseHostVersion("26.5")));
  CHECK(!hostExperimental(parseHostVersion("25.6")));
  CHECK(!hostExperimental(parseHostVersion("24.0")));
  CHECK(!hostExperimental(parseHostVersion("unknown")));
  const JsonValue host = parsed(hostProfileJson("27.1.0 (build 3)", facts(true)));
  CHECK(at(host, "experimental").boolean);
  CHECK(at(host, "supported").boolean);
  CHECK(!at(host, "measured").boolean);
}

TEST(revision_guard_is_on_for_every_supported_release_and_when_unreadable) {
  CHECK(revisionGuardOn(parseHostVersion("25.6")));
  CHECK(revisionGuardOn(parseHostVersion("26.5")));
  CHECK(revisionGuardOn(parseHostVersion("27.0")));
  CHECK(revisionGuardOn(parseHostVersion("unknown")));
  CHECK(!revisionGuardOn(parseHostVersion("24.6")));
  const JsonValue host = parsed(hostProfileJson("25.6.0 (build 41)", facts(true)));
  CHECK_EQ(at(at(host, "capabilities"), "revisionGuard").text, std::string("on"));
}

TEST(ae26_profile_is_measured_with_native_svg) {
  const JsonValue host = parsed(hostProfileJson("26.5.0 (build 61)", facts(true)));
  CHECK_EQ(at(host, "family").text, std::string("ae26"));
  CHECK(at(host, "measured").boolean);
  CHECK_EQ(at(at(host, "capabilities"), "svgImport").text, std::string("native"));
}

TEST(older_and_unreadable_hosts_degrade_explicitly) {
  const JsonValue older = parsed(hostProfileJson("24.6.0", facts(false, false)));
  CHECK(!at(older, "supported").boolean);
  CHECK_EQ(at(at(older, "capabilities"), "expressionText").text, std::string("utf8"));
  CHECK(!at(at(older, "capabilities"), "suitesComplete").boolean);
  const JsonValue unknown = parsed(hostProfileJson("unknown", facts(true)));
  CHECK_EQ(at(unknown, "family").text, std::string("unknown"));
  CHECK(at(unknown, "supported").boolean);
  CHECK(!at(unknown, "measured").boolean);
  CHECK(at(unknown, "major").isNull());
}

TEST(both_pings_carry_the_host_object) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  exec.info.aeVersion = "25.6.0 (build 41)";
  exec.info.hostJson = hostProfileJson(exec.info.aeVersion, facts(true));
  const ParsedRequest ping = parseRequest(R"({"op":"ping"})");
  CHECK(ping.ok);
  const JsonValue main = parsed(executeRequest(ping.request, host, exec.context(), 0));
  CHECK_EQ(at(at(at(main, "result"), "host"), "family").text, std::string("ae25"));
  const ParsedRequest direct = parseRequest(R"({"op":"ping_direct"})");
  CHECK(direct.ok);
  const JsonValue socket = parsed(directPingResponse(direct.request, exec.info, DirectStatus()));
  CHECK_EQ(at(at(at(socket, "result"), "host"), "family").text, std::string("ae25"));
  fake::Exec bare;
  const JsonValue none = parsed(executeRequest(ping.request, host, bare.context(), 0));
  CHECK(at(at(none, "result"), "host").isNull());
}

TEST(shared_vectors_give_the_same_identity_as_the_typescript_side) {
  const std::ifstream file(EXTYNT_VECTORS_DIR "/host_versions.json");
  CHECK(file.good());
  std::stringstream buffer;
  buffer << file.rdbuf();
  JsonValue doc;
  std::string error;
  CHECK(parseJson(buffer.str(), doc, error));
  const JsonValue* cases = doc.find("cases");
  CHECK(cases != nullptr && cases->isArray() && cases->items.size() >= 8);
  for (const JsonValue& item : cases->items) {
    const std::string input = at(item, "input").text;
    const JsonValue host = parsed(hostProfileJson(input, facts(true)));
    CHECK_EQ(at(host, "family").text, at(item, "family").text);
    CHECK_EQ(at(at(host, "capabilities"), "svgImport").text, at(item, "svgImport").text);
    CHECK_EQ(at(host, "supported").boolean, at(item, "supported").boolean);
    CHECK_EQ(at(host, "measured").boolean, at(item, "measured").boolean);
    CHECK_EQ(at(host, "experimental").boolean, at(item, "experimental").boolean);
    CHECK_EQ(at(at(host, "capabilities"), "revisionGuard").text, at(item, "revisionGuard").text);
    CHECK_EQ(at(host, "major").isNull(), at(item, "major").isNull());
    if (!at(item, "major").isNull()) CHECK_EQ(at(host, "major").number, at(item, "major").number);
    CHECK_EQ(at(host, "build").isNull(), at(item, "build").isNull());
    if (!at(item, "build").isNull()) CHECK_EQ(at(host, "build").text, at(item, "build").text);
  }
}

}

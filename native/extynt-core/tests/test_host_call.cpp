// host_call: the allowlist, how scripts are built, library loading, errors, and a mutation followed by reads in one
// batch.
#include <array>
#include <cstddef>
#include <string>

#include "executor.h"
#include "fake_host.h"
#include "host_call.h"
#include "host_entries.h"
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

std::string quoted(const std::string& text) {
  std::string out = "\"";
  for (const char c : text) {
    if (c == '"' || c == '\\') out += '\\';
    out += c;
  }
  return out + "\"";
}

std::string callLine(const std::string& entry, const std::string& args = "{}") {
  return R"({"id":"h","op":"host_call","entry":")" + entry + R"(","args":)" + quoted(args) + "}";
}

std::string runLine(fake::Host& host, fake::Exec& exec, const std::string& line) {
  const ParsedRequest request = parseRequest(line);
  if (!request.ok) throw testing::Failure{"request refused: " + request.errorMessage};
  return executeRequest(request.request, host, exec.context(), 0);
}

bool startsWith(const std::string& text, const std::string& prefix) { return text.rfind(prefix, 0) == 0; }

std::string errorCode(const std::string& reply) { return at(at(parsed(reply), "error"), "code").text; }

TEST(every_allowlisted_entry_parses_and_everything_else_is_refused) {
  constexpr std::array<const char*, kHostEntryCount> kNames = {
      {"aeApplyPlan", "aeUndoPlan", "aePreviewControlValues", "aeCaptureFrame", "aeDiscardCaptureFrame", "aeHostCensus",
       "aeCatalogueProbePage", "aeCatalogueReadInstance", "aeCollectIndexPage", "aeCollectDetailPage",
       "aeCollectValuePage", "aeCollectBlurControl", "aeCollectEffectCreation", "aeReadPropertyDetails"}};
  for (const char* name : kNames) {
    const ParsedRequest request = parseRequest(callLine(name));
    CHECK(request.ok);
    CHECK(request.request.op == Op::HostCall);
    CHECK_EQ(std::string(hostEntryName(request.request.entry)), std::string(name));
  }
  for (const char* bad : {"aeApplyPlan2", "AEApplyPlan", "aeApplyPlan ", "app.quit", "eval", "",
                          "aeApplyPlan;app.quit()", "aeHostLoadErrors", "aeProbeReadBudget"}) {
    const ParsedRequest refused = parseRequest(callLine(bad));
    CHECK(!refused.ok);
    CHECK_EQ(refused.errorCode, std::string("ENTRY_NOT_ALLOWED"));
  }
}

TEST(arguments_must_be_a_string_holding_a_json_object) {
  for (const char* bad :
       {R"({"op":"host_call","entry":"aeApplyPlan"})", R"({"op":"host_call","entry":"aeApplyPlan","args":{"a":1}})",
        R"({"op":"host_call","entry":"aeApplyPlan","args":"[1]"})",
        R"({"op":"host_call","entry":"aeApplyPlan","args":"5"})",
        R"({"op":"host_call","entry":"aeApplyPlan","args":"not json"})",
        R"({"op":"host_call","entry":"aeApplyPlan","args":"null"})", R"({"op":"host_call","args":"{}"})",
        R"({"op":"host_call","entry":5,"args":"{}"})"}) {
    const ParsedRequest refused = parseRequest(bad);
    CHECK(!refused.ok);
    CHECK_EQ(refused.errorCode, std::string("BAD_REQUEST"));
  }
}

TEST(no_script_text_is_ever_accepted_over_the_socket) {
  for (const char* line : {R"j({"op":"execute_script","script":"app.quit()"})j", R"({"op":"eval","script":"1"})",
                           R"({"op":"host_script","script":"1"})"}) {
    CHECK_EQ(parseRequest(line).errorCode, std::string("UNKNOWN_OP"));
  }
  const ParsedRequest request =
      parseRequest(R"j({"op":"host_call","entry":"aeUndoPlan","args":"{}","script":"app.quit()","code":"1"})j");
  CHECK(request.ok);
  CHECK_EQ(request.request.argsJson, std::string("{}"));
}

TEST(the_argument_bytes_pass_through_unchanged) {
  const std::string args =
      std::string(R"({"n":1.0,"big":12345678901234567890,"s":"a\"b\\c\nd)") + "\xE2\x80\xA8" + R"(e","k":[1,2.50]})";
  const ParsedRequest request = parseRequest(callLine("aeApplyPlan", args));
  CHECK(request.ok);
  CHECK_EQ(request.request.argsJson, args);
}

TEST(a_request_of_16_mib_is_accepted_and_one_byte_more_is_not) {
  CHECK_EQ(kMaxRequestBytes, size_t(16) * 1024 * 1024);
  const std::string big = std::string(R"({"a":")") + std::string(size_t{2} << 20, 'x') + R"("})";
  CHECK(parseRequest(callLine("aeApplyPlan", big)).ok);
  const ParsedRequest tooLarge = parseRequest(std::string(kMaxRequestBytes + 1, ' '));
  CHECK_EQ(tooLarge.errorCode, std::string("REQUEST_TOO_LARGE"));
}

TEST(the_entry_script_sets_the_epoch_and_escapes_the_arguments) {
  const std::string args = R"({"s":"a\"b\\c\nd"})";
  const std::string script = buildEntryScript({HostEntry::ApplyPlan, 7}, args);
  CHECK(startsWith(script, "__extyntProjectEpoch = 7; aeApplyPlan(\""));
  CHECK_EQ(script,
           std::string("__extyntProjectEpoch = 7; aeApplyPlan(\"{\\\"s\\\":\\\"a\\\\\\\"b\\\\\\\\c\\\\nd\\\"}\");"));
  const std::string raw = std::string("{\"s\":\"line\nbreak\xE2\x80\xA8 and\xE2\x80\xA9 tab\t\"}");
  CHECK_EQ(buildEntryScript({HostEntry::CatalogueProbePage, 3, true}, "{}"),
           std::string("__extyntProjectEpoch = 3; __extyntEngineProcess = true; aeCatalogueProbePage(\"{}\");"));
  CHECK(buildEntryScript({HostEntry::CatalogueProbePage, 3, false}, "{}").find("__extyntEngineProcess") ==
        std::string::npos);
  CHECK_EQ(buildEntryScript({HostEntry::ApplyPlan, 3, false, 41}, "{}"),
           std::string("__extyntProjectEpoch = 3; __extyntBridgeCommand = 41; aeApplyPlan(\"{}\");"));
  CHECK_EQ(buildEntryScript({HostEntry::ApplyPlan, 3, true, 41}, "{}"),
           std::string("__extyntProjectEpoch = 3; __extyntEngineProcess = true; __extyntBridgeCommand = 41; "
                       "aeApplyPlan(\"{}\");"));
  CHECK(buildEntryScript({HostEntry::ApplyPlan, 3, false, 0}, "{}").find("__extyntBridgeCommand") == std::string::npos);
  const std::string rawScript = buildEntryScript({HostEntry::UndoPlan, 0}, raw);
  CHECK(rawScript.find('\n') == std::string::npos);
  CHECK(rawScript.find("\xE2\x80\xA8") == std::string::npos);
  CHECK(rawScript.find("\\u2028") != std::string::npos);
  CHECK(rawScript.find("\\u2029") != std::string::npos);
  CHECK(rawScript.find("\\x0a") != std::string::npos);
  CHECK(rawScript.find("\\x09") != std::string::npos);
  CHECK(startsWith(rawScript, "__extyntProjectEpoch = 0; aeUndoPlan(\""));
}

TEST(the_guard_script_loads_at_the_top_level_with_the_version_and_the_escaped_path) {
  LibraryEntry library;
  library.version = "0.1.0+0123456789ab";
  library.entryFile = R"(/Lib/Support "x"/back\slash/probe.jsx)";
  const std::string script = buildLibraryGuardScript(library);
  CHECK(startsWith(script,
                   "if (typeof JSON !== \"object\") { try { $.evalFile(File(\"/Lib/Support \\\"x\\\"/back\\\\slash/"
                   "json.jsx\")); } catch (jsonLoadError) {} }\n"));
  CHECK(script.find("\nif (typeof JSON !== \"object\") { __extyntHostLibraryState = \"not-ready\"; }") !=
        std::string::npos);
  CHECK(script.find("else if (typeof __extyntHostLibrary !== \"string\" || __extyntHostLibrary !== "
                    "\"0.1.0+0123456789ab\")") != std::string::npos);
  CHECK(script.find("$.evalFile(File(\"/Lib/Support \\\"x\\\"/back\\\\slash/probe.jsx\"))") != std::string::npos);
  CHECK(script.find("__extyntHostLibrary = \"0.1.0+0123456789ab\";") != std::string::npos);
  CHECK(script.find("aeHostLoadErrors.slice(0, 3).join(\" | \")") != std::string::npos);
  CHECK(script.find("else { __extyntHostLibraryState = \"resident\"; }") != std::string::npos);
  CHECK(script.rfind("__extyntHostLibraryState;") == script.size() - std::string("__extyntHostLibraryState;").size());
  CHECK(script.find("function") == std::string::npos);
  CHECK(script.find("=>") == std::string::npos);
}

TEST(a_call_loads_the_library_once_then_finds_it_resident) {
  fake::Host host = fake::makeScene();
  host.entryAnswers["aeUndoPlan"] = R"({"ok":true,"times":1})";
  fake::Exec exec;
  const JsonValue first = parsed(runLine(host, exec, callLine("aeUndoPlan", R"({"planId":"p1"})")));
  CHECK(at(first, "ok").boolean);
  const JsonValue& result = at(first, "result");
  CHECK_EQ(at(result, "source").text, std::string("native"));
  CHECK_EQ(at(result, "entry").text, std::string("aeUndoPlan"));
  CHECK_EQ(at(result, "result").text, std::string(R"({"ok":true,"times":1})"));
  CHECK(at(result, "libraryLoaded").boolean);
  CHECK_EQ(at(result, "libraryVersion").text, std::string("0.1.0+0123456789ab"));
  CHECK_EQ(at(result, "projectEpoch").number, 1.0);
  CHECK_EQ(at(result, "scriptUs").number, 250.0);
  CHECK(result.find("scriptError") == nullptr);
  CHECK_EQ(host.scripts.size(), size_t(3));
  CHECK(startsWith(host.scripts[0], "if (typeof JSON"));
  CHECK_EQ(host.scripts[1], std::string("app.project.revision"));
  CHECK_EQ(host.scripts[2], std::string("__extyntProjectEpoch = 1; aeUndoPlan(\"{\\\"planId\\\":\\\"p1\\\"}\");"));

  const JsonValue second = parsed(runLine(host, exec, callLine("aeUndoPlan")));
  CHECK(at(at(second, "result"), "libraryLoaded").boolean == false);
  CHECK_EQ(host.libraryLoads, 1);
  CHECK_EQ(exec.library.get().version, std::string("0.1.0+0123456789ab"));
  CHECK_EQ(exec.library.get().entryFile, host.library.entryFile);
}

TEST(a_missing_manifest_or_a_bad_version_stops_before_any_script_runs) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  host.library = LibraryEntry();
  host.library.note = "no manifest anywhere";
  const std::string missing = runLine(host, exec, callLine("aeApplyPlan"));
  CHECK_EQ(errorCode(missing), std::string("LIBRARY_NOT_FOUND"));
  CHECK(missing.find("no manifest anywhere") != std::string::npos);
  CHECK(host.scripts.empty());

  for (const char* version : {"", "1\"; app.quit(); \"", "1 2", "1\n2"}) {
    host.library.entryFile = "/x/probe.jsx";
    host.library.version = version;
    CHECK_EQ(errorCode(runLine(host, exec, callLine("aeApplyPlan"))), std::string("LIBRARY_VERSION_INVALID"));
  }
  host.library.version = std::string(65, 'a');
  CHECK_EQ(errorCode(runLine(host, exec, callLine("aeApplyPlan"))), std::string("LIBRARY_VERSION_INVALID"));
  CHECK(host.scripts.empty());
}

TEST(load_errors_stop_the_entry_and_the_next_call_loads_again) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  host.libraryLoadError = "read-layers.jsx: ReferenceError (line 4) | census.jsx: SyntaxError";
  const std::string failed = runLine(host, exec, callLine("aeApplyPlan"));
  CHECK_EQ(errorCode(failed), std::string("LIBRARY_LOAD_FAILED"));
  CHECK(failed.find("read-layers.jsx: ReferenceError") != std::string::npos);
  for (const std::string& script : host.scripts) CHECK(!startsWith(script, "__extyntProjectEpoch"));
  CHECK_EQ(host.libraryLoads, 0);

  host.libraryLoadError.clear();
  const JsonValue retried = parsed(runLine(host, exec, callLine("aeApplyPlan")));
  CHECK(at(retried, "ok").boolean);
  CHECK(at(at(retried, "result"), "libraryLoaded").boolean);
  CHECK_EQ(host.libraryLoads, 1);

  fake::Host odd = fake::makeScene();
  odd.scriptHook = [](const std::string&, fake::Host&) { return ScriptRun{"", 1, "Error 5: bad"}; };
  CHECK_EQ(errorCode(runLine(odd, exec, callLine("aeApplyPlan"))), std::string("LIBRARY_LOAD_FAILED"));
}

TEST(a_failing_script_is_script_failed_and_a_reported_error_rides_along) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  host.scriptHook = [](const std::string& script, fake::Host& self) {
    if (script.find("aeApplyPlan(") != std::string::npos) return ScriptRun{"", 90, "Error 25: Object is invalid"};
    if (script.find("aeUndoPlan(") != std::string::npos) return ScriptRun{R"({"ok":false})", 90, "warning text"};
    return self.defaultScript(script);
  };
  const std::string failed = runLine(host, exec, callLine("aeApplyPlan"));
  CHECK_EQ(errorCode(failed), std::string("SCRIPT_FAILED"));
  CHECK(failed.find("Error 25") != std::string::npos);
  const JsonValue partial = parsed(runLine(host, exec, callLine("aeUndoPlan")));
  CHECK(at(partial, "ok").boolean);
  CHECK_EQ(at(at(partial, "result"), "scriptError").text, std::string("warning text"));
  CHECK_EQ(at(at(partial, "result"), "result").text, std::string(R"({"ok":false})"));
}

TEST(a_modal_dialog_refuses_the_guard_and_the_entry_as_nothing_run) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  const std::string modal = std::string(kModalDialogErrorPrefix) + ": After Effects has a dialog open";
  host.scriptHook = [&](const std::string&, fake::Host&) { return ScriptRun{"", 0, modal}; };
  const std::string refused = runLine(host, exec, callLine("aeHostCensus"));
  CHECK_EQ(errorCode(refused), std::string("HOST_MODAL_DIALOG"));
  CHECK_EQ(host.scripts.size(), size_t(1));
  CHECK_EQ(host.libraryLoads, 0);
  CHECK_EQ(host.notes.size(), size_t(1));
  CHECK(host.notes[0].find("HOST_MODAL_DIALOG") != std::string::npos);

  host.scriptHook = [&](const std::string& script, fake::Host& self) {
    if (script.rfind("__extyntProjectEpoch = ", 0) == 0) return ScriptRun{"", 0, modal};
    return self.defaultScript(script);
  };
  CHECK_EQ(errorCode(runLine(host, exec, callLine("aeHostCensus"))), std::string("HOST_MODAL_DIALOG"));
  host.scriptHook = nullptr;
  CHECK(at(parsed(runLine(host, exec, callLine("aeHostCensus"))), "ok").boolean);
}

TEST(an_engine_without_json_is_refused_as_not_ready_before_anything_is_loaded_or_run) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  host.engineNotReadyCalls = 2;
  const std::string refused = runLine(host, exec, callLine("aeHostCensus"));
  CHECK_EQ(errorCode(refused), std::string("SCRIPT_ENGINE_NOT_READY"));
  const JsonValue refusal = parsed(refused);
  const JsonValue& error = at(refusal, "error");
  CHECK_EQ(at(error, "scriptUs").number, 250.0);
  CHECK(at(error, "libraryLoaded").boolean == false);
  CHECK_EQ(at(error, "libraryLoadUs").number, 0.0);
  CHECK_EQ(host.scripts.size(), size_t(1));
  CHECK_EQ(host.libraryLoads, 0);
  CHECK_EQ(host.notes.size(), size_t(1));
  CHECK(host.notes[0].find("aeHostCensus") != std::string::npos);
  CHECK(host.notes[0].find("SCRIPT_ENGINE_NOT_READY") != std::string::npos);

  CHECK_EQ(errorCode(runLine(host, exec, callLine("aeHostCensus"))), std::string("SCRIPT_ENGINE_NOT_READY"));
  CHECK_EQ(host.notes.size(), size_t(2));
  const JsonValue ready = parsed(runLine(host, exec, callLine("aeHostCensus")));
  CHECK(at(ready, "ok").boolean);
  CHECK(at(at(ready, "result"), "libraryLoaded").boolean);
  CHECK_EQ(host.notes.size(), size_t(2));
}

TEST(readiness_costs_no_script_beyond_the_guard_and_the_second_call_runs_only_the_entry) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  runLine(host, exec, callLine("aeHostCensus"));
  const size_t first = host.scripts.size();
  runLine(host, exec, callLine("aeHostCensus"));
  CHECK_EQ(first, size_t(3));
  CHECK_EQ(host.scripts.size() - first, size_t(3));
  for (const std::string& script : host.scripts) CHECK(script.rfind("typeof JSON", 0) != 0);
}

TEST(a_failed_entry_keeps_its_timing_and_is_noted_in_the_log) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  host.scriptHook = [](const std::string& script, fake::Host& self) {
    if (script.find("aeApplyPlan(") != std::string::npos) return ScriptRun{"", 90, "JSON is undefined"};
    return self.defaultScript(script);
  };
  const JsonValue failed = parsed(runLine(host, exec, callLine("aeApplyPlan")));
  const JsonValue& error = at(failed, "error");
  CHECK_EQ(at(error, "code").text, std::string("SCRIPT_FAILED"));
  CHECK_EQ(at(error, "scriptUs").number, 90.0);
  CHECK(at(error, "libraryLoaded").boolean);
  CHECK_EQ(at(error, "libraryLoadUs").number, 250.0);
  CHECK_EQ(host.notes.size(), size_t(1));
  CHECK(host.notes[0].find("JSON is undefined") != std::string::npos);
}

TEST(the_epoch_follows_the_project_identity_and_a_falling_revision) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  auto epochOf = [&] {
    return at(at(parsed(runLine(host, exec, callLine("aeHostCensus"))), "result"), "projectEpoch").number;
  };
  CHECK_EQ(epochOf(), 1.0);
  host.revision = 9300;
  CHECK_EQ(epochOf(), 1.0);
  host.revision = 9310;
  CHECK_EQ(epochOf(), 1.0);
  host.revision = 12;
  CHECK_EQ(epochOf(), 2.0);
  host.projectInfo.filePath = std::string("/tmp/Other.aep");
  CHECK_EQ(epochOf(), 3.0);
  host.projectInfo.name = "Other.aep";
  CHECK_EQ(epochOf(), 4.0);
  CHECK_EQ(epochOf(), 4.0);
  host.noProject = true;
  CHECK_EQ(epochOf(), 5.0);
  CHECK_EQ(exec.watch.epoch(), 5);
}

TEST(a_mutation_and_the_reads_after_it_run_in_one_batch_turn) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  host.scriptHook = [](const std::string& script, fake::Host& self) {
    if (script.find("aeApplyPlan(") == std::string::npos) return self.defaultScript(script);
    self.setOpacity("3", "20", 60);
    return ScriptRun{R"({"ok":true,"steps":1})", 300, ""};
  };
  const std::string line =
      R"({"id":"b","op":"batch","ops":[{"id":"before","op":"watch_state"},)" +
      callLine("aeApplyPlan", R"({"planId":"p"})").replace(0, 1, "{") +
      R"(,{"id":"read","op":"read_paths","targets":[{"compId":3,"layerId":20,"path":"ADBE Transform Group/ADBE Opacity"}]},)"
      R"({"id":"after","op":"watch_state"}]})";
  const JsonValue reply = parsed(runLine(host, exec, line));
  CHECK(at(reply, "ok").boolean);
  const JsonValue& results = at(at(reply, "result"), "results");
  CHECK_EQ(results.items.size(), size_t(4));
  for (const JsonValue& item : results.items) CHECK(at(item, "ok").boolean);
  CHECK_EQ(at(at(results.items[1], "result"), "entry").text, std::string("aeApplyPlan"));
  const JsonValue& entry = at(at(results.items[2], "result"), "results").items[0];
  CHECK_EQ(at(at(entry, "entry"), "value").number, 60.0);
  CHECK_EQ(at(at(results.items[0], "result"), "revision").number, 9264.0);
  CHECK(host.invalidations >= 1);
}

TEST(a_failing_host_call_inside_a_batch_is_one_failed_entry) {
  fake::Host host = fake::makeScene();
  host.library = LibraryEntry();
  fake::Exec exec;
  const std::string line =
      R"({"op":"batch","ops":[{"op":"host_call","entry":"aeApplyPlan","args":"{}"},{"op":"revision"}]})";
  const JsonValue reply = parsed(runLine(host, exec, line));
  CHECK(at(reply, "ok").boolean);
  const JsonValue& results = at(at(reply, "result"), "results");
  CHECK_EQ(at(at(results.items[0], "error"), "code").text, std::string("LIBRARY_NOT_FOUND"));
  CHECK(at(results.items[1], "ok").boolean);
  CHECK_EQ(at(at(reply, "result"), "failed").number, 1.0);
}

TEST(watch_and_ping_direct_are_refused_inside_a_batch_and_host_call_with_watch_state_are_not) {
  const ParsedRequest watch = parseRequest(R"({"op":"batch","ops":[{"op":"watch"}]})");
  CHECK(!watch.ok);
  CHECK(watch.errorMessage.find("ops[0]") != std::string::npos);
  CHECK(!parseRequest(R"({"op":"batch","ops":[{"op":"ping_direct"}]})").ok);
  CHECK(parseRequest(
            R"({"op":"batch","ops":[{"op":"watch_state"},{"op":"host_call","entry":"aeHostCensus","args":"{}"}]})")
            .ok);
  const ParsedRequest subscribed = parseRequest(R"({"op":"watch","intervalMs":50,"stillMs":10000})");
  CHECK(subscribed.ok);
  CHECK_EQ(subscribed.request.watchIntervalMs, 50);
  CHECK_EQ(subscribed.request.watchStillMs, 10000);
  CHECK_EQ(parseRequest(R"({"op":"watch"})").request.watchIntervalMs, 100);
  CHECK_EQ(parseRequest(R"({"op":"watch"})").request.watchStillMs, 1000);
  for (const char* bad : {R"({"op":"watch","intervalMs":49})", R"({"op":"watch","intervalMs":2001})",
                          R"({"op":"watch","stillMs":249})", R"({"op":"watch","stillMs":10001})",
                          R"({"op":"watch","intervalMs":"fast"})", R"({"op":"watch","stillMs":1.5})"}) {
    CHECK_EQ(parseRequest(bad).errorCode, std::string("BAD_REQUEST"));
  }
}

}

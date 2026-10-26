// Renders the fixed ExtendScript templates of apply_test and undo_test and verifies each with a native read.

#include "write_ops.h"

#include <chrono>
#include <cmath>
#include <string>
#include <ratio>
#include <cstddef>

#include "host_reader.h"
#include "json_writer.h"
#include "request.h"
#include "timing.h"
#include "walker.h"

namespace extynt {

const char* const kOpacityPath = "ADBE Transform Group/ADBE Opacity";

namespace {

constexpr double kVerifyTolerance = 1e-3;

void requireDigits(const Id& id, const char* what) {
  bool ok = !id.empty() && id.size() <= 15;
  for (const char c : id) ok = ok && c >= '0' && c <= '9';
  if (!ok) throw HostFailure(std::string(what) + " must be a plain integer id", 0, "BAD_REQUEST");
}

double microsSince(SteadyClock::time_point start) {
  return std::chrono::duration<double, std::micro>(SteadyClock::now() - start).count();
}

bool scriptOk(const ScriptRun& run, const char* expected) { return run.error.empty() && run.result == expected; }

void writeScriptFields(JsonWriter& w, const ScriptRun& run) {
  w.field("scriptResult", run.result);
  if (!run.error.empty()) w.field("scriptError", run.error);
  w.fieldNum("scriptUs", run.us);
}

bool numberOf(const PathValue& value, double& out) {
  if (!value.found || value.leaf.value.kind != ValueRead::Kind::Number) return false;
  out = value.leaf.value.v[0];
  return true;
}

void writeReadBack(JsonWriter& w, const PathValue& value, bool& haveNumber, double& number) {
  haveNumber = numberOf(value, number);
  if (haveNumber) w.fieldNum("readBack", number);
  else w.fieldNull("readBack");
  if (!value.found) w.field("readError", value.error);
}

}

namespace {

bool isLineSeparator(const std::string& text, size_t i) {
  if (static_cast<unsigned char>(text[i]) != 0xE2 || i + 2 >= text.size()) return false;
  const auto second = static_cast<unsigned char>(text[i + 1]);
  const auto third = static_cast<unsigned char>(text[i + 2]);
  return second == 0x80 && (third == 0xA8 || third == 0xA9);
}

}

std::string escapeJsString(const std::string& text) {
  static constexpr std::string_view kHex = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < text.size(); ++i) {
    const auto c = static_cast<unsigned char>(text[i]);
    if (c == '\\' || c == '"') {
      out += '\\';
      out += static_cast<char>(c);
    } else if (c < 0x20 || c == 0x7f) {
      out += "\\x";
      out += kHex[c >> 4];
      out += kHex[c & 15];
    } else if (isLineSeparator(text, i)) {
      out += static_cast<unsigned char>(text[i + 2]) == 0xA8 ? "\\u2028" : "\\u2029";
      i += 2;
    } else {
      out += static_cast<char>(c);
    }
  }
  return out;
}

std::string buildApplyOpacityScript(const Id& compId, const Id& layerId, double opacity) {
  requireDigits(compId, "compId");
  requireDigits(layerId, "layerId");
  if (!std::isfinite(opacity) || opacity < 0 || opacity > 100)
    throw HostFailure("opacity must be a number from 0 to 100", 0, "BAD_REQUEST");
  return std::string("(function(){") + "var c=app.project.itemByID(" + compId + ");" +
         "if(!c||!(c instanceof CompItem))return \"ERR:comp\";" +
         "var L=null;for(var i=1;i<=c.numLayers;i++){if(c.layer(i).id===" + layerId + "){L=c.layer(i);break;}}" +
         "if(!L)return \"ERR:layer\";" +
         R"(var g=L.property("ADBE Transform Group");var p=g?g.property("ADBE Opacity"):null;)" +
         "if(!p)return \"ERR:opacity\";" + "app.beginUndoGroup(\"extynt native apply test\");" +
         "var r=\"OK\";try{p.setValue(" + formatDouble(opacity) + ");}catch(e){r=\"ERR:\"+String(e);}" +
         "app.endUndoGroup();return r;" + "})()";
}

std::string buildUndoScript() {
  return R"((function(){try{app.executeCommand(16);return "OK";}catch(e){return "ERR:"+String(e);}})())";
}

std::string runApplyTest(HostReader& host, const Request& request) {
  const SteadyClock::time_point start = SteadyClock::now();
  const ScriptRun run =
      host.executeFixedScript(buildApplyOpacityScript(request.compId, request.layerId, request.opacity));
  host.invalidateCaches();
  const SteadyClock::time_point verifyStart = SteadyClock::now();
  Walker walker(host, WalkOptions());
  const PathValue value = walker.readValue(PathTarget{request.compId, request.layerId, kOpacityPath});
  const double verifyUs = microsSince(verifyStart);

  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("source", "native");
  w.field("compId", request.compId);
  w.field("layerId", request.layerId);
  w.fieldNum("requested", request.opacity);
  const bool applied = scriptOk(run, "OK");
  w.fieldBool("applied", applied);
  writeScriptFields(w, run);
  w.fieldNum("verifyUs", verifyUs);
  bool haveNumber = false;
  double readBack = 0;
  writeReadBack(w, value, haveNumber, readBack);
  w.fieldBool("verified", applied && haveNumber && std::fabs(readBack - request.opacity) <= kVerifyTolerance);
  w.fieldNum("totalUs", microsSince(start));
  w.endObject();
  return text;
}

std::string runUndoTest(HostReader& host, const Request& request) {
  const SteadyClock::time_point start = SteadyClock::now();
  const ScriptRun run = host.executeFixedScript(buildUndoScript());
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  w.field("source", "native");
  w.fieldBool("applied", scriptOk(run, "OK"));
  writeScriptFields(w, run);
  if (request.hasLayerTarget) {
    host.invalidateCaches();
    const SteadyClock::time_point verifyStart = SteadyClock::now();
    Walker walker(host, WalkOptions());
    const PathValue value = walker.readValue(PathTarget{request.compId, request.layerId, kOpacityPath});
    w.fieldNum("verifyUs", microsSince(verifyStart));
    bool haveNumber = false;
    double readBack = 0;
    writeReadBack(w, value, haveNumber, readBack);
  }
  w.fieldNum("totalUs", microsSince(start));
  w.endObject();
  return text;
}

}

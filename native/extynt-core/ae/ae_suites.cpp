// Acquires the AEGP suites the plugin uses and records which optional ones the host withheld.
#include "ae_suites.h"

#include <initializer_list>
#include <string>
#include <vector>

#include "SPBasic.h"
#include "json_writer.h"
#include "sdk_suite_ids.h"
#include "sdk_suites.h"

namespace extynt::ae {

namespace {

class SuiteLoader {
 public:
  SuiteLoader(const SPBasicSuite* basic, Suites* suites) : basic_(basic), suites_(suites) {}

  template <typename Suite>
  void acquireNewest(const char* key, std::initializer_list<SuiteId<Suite>> ids, const Suite*& slot) const {
    SuiteStatus status;
    status.key = key;
    status.sdkName = ids.begin()->name;
    status.requested = ids.begin()->version;
    for (const SuiteId<Suite>& id : ids) {
      if (acquireSuite(*basic_, id, slot, status.error)) {
        status.acquired = id.version;
        break;
      }
    }
    suites_->status.push_back(status);
  }

 private:
  const SPBasicSuite* basic_;
  Suites* suites_;
};

void releaseOne(const SPBasicSuite* basic, const SuiteStatus& status) {
  if (status.acquired != 0) basic->ReleaseSuite(status.sdkName.c_str(), status.acquired);
}

}

std::string Suites::firstMissing() const {
  for (const SuiteStatus& entry : status) {
    if (entry.acquired == 0) return entry.sdkName + " v" + std::to_string(entry.requested);
  }
  return "";
}

void acquireSuites(const SPBasicSuite* basic, Suites& suites) {
  suites = Suites();
  if (!basic) return;
  const SuiteLoader loader(basic, &suites);
  loader.acquireNewest("memory", {suite::kMemory}, suites.memory);
  loader.acquireNewest("project", {suite::kProject}, suites.project);
  loader.acquireNewest("item", {suite::kItem}, suites.item);
  loader.acquireNewest("comp", {suite::kComp}, suites.comp);
  loader.acquireNewest("layer", {suite::kLayer}, suites.layer);
  loader.acquireNewest("stream", {suite::kStream5, suite::kStream6AsSuite5, suite::kStream4AsSuite5}, suites.stream);
  for (const SuiteStatus& entry : suites.status) {
    if (entry.key == "stream") suites.streamVersion = entry.acquired;
  }
  loader.acquireNewest("effect", {suite::kEffect}, suites.effect);
  loader.acquireNewest("dynamicStream", {suite::kDynamicStream}, suites.dynamic);
  loader.acquireNewest("keyframe", {suite::kKeyframe}, suites.keyframe);
  loader.acquireNewest("textDocument", {suite::kTextDocument}, suites.textDocument);
  loader.acquireNewest("marker", {suite::kMarker}, suites.marker);
  loader.acquireNewest("maskOutline", {suite::kMaskOutline}, suites.maskOutline);
  loader.acquireNewest("collection", {suite::kCollection}, suites.collection);
  loader.acquireNewest("utility", {suite::kUtility4, suite::kUtility5AsSuite4}, suites.utility);
  loader.acquireNewest("register", {suite::kRegister}, suites.registrar);
}

void releaseSuites(const SPBasicSuite* basic, Suites& suites) {
  if (basic) {
    for (const SuiteStatus& entry : suites.status) releaseOne(basic, entry);
  }
  suites = Suites();
}

std::string suitesJson(const Suites& suites, long apiMajor, long apiMinor, const std::vector<SuiteStatus>& extra) {
  std::string text;
  JsonWriter w(text);
  w.beginObject();
  std::vector<SuiteStatus> all = suites.status;
  all.insert(all.end(), extra.begin(), extra.end());
  for (const SuiteStatus& entry : all) {
    w.key(entry.key);
    w.beginObject();
    w.field("name", entry.sdkName);
    w.fieldInt("requested", entry.requested);
    w.fieldInt("version", entry.acquired);
    w.fieldBool("ok", entry.acquired != 0);
    if (entry.acquired == 0) w.fieldInt("error", entry.error);
    w.endObject();
  }
  w.field("_pluginApi", std::to_string(apiMajor) + "." + std::to_string(apiMinor));
  w.endObject();
  return text;
}

}

// Suite acquisition. Every suite is requested at the OLDEST version that has what the spike
// needs, so one binary loads on AE 25.0 and later; the reasoning per suite is in docs/native/plugin-design.md.
#pragma once

#include <string>
#include <vector>

#include "ae_sdk.h"

namespace extynt::ae {

struct SuiteStatus {
  std::string key;
  std::string sdkName;
  int requested = 0;
  int acquired = 0;
  long error = 0;
};

struct Suites {
  const AEGP_MemorySuite1* memory = nullptr;
  const AEGP_ProjSuite5* project = nullptr;
  const AEGP_ItemSuite8* item = nullptr;
  const AEGP_CompSuite4* comp = nullptr;
  const AEGP_LayerSuite9* layer = nullptr;
  // Typed as StreamSuite5: versions 9 (Suite4), 10 (Suite5) and 11 (Suite6) share the member list this
  // adapter uses, and differ only in AEGP_GetExpression's text (8-bit in v9, UTF-16 from v10).
  const AEGP_StreamSuite5* stream = nullptr;
  int streamVersion = 0;

  // Frozen at version 5 since AE 24.1; the popup reads use its layer-effect and param-union calls.
  const AEGP_EffectSuite5* effect = nullptr;
  const AEGP_DynamicStreamSuite4* dynamic = nullptr;
  // Version 4 is the oldest whose key values are AEGP_StreamValue2 with the marker handle the Marker suite reads;
  // version 5 only appends the label calls, so the members this adapter calls are the same.
  const AEGP_KeyframeSuite4* keyframe = nullptr;
  const AEGP_TextDocumentSuite1* textDocument = nullptr;
  const AEGP_MarkerSuite3* marker = nullptr;
  const AEGP_MaskOutlineSuite3* maskOutline = nullptr;
  const AEGP_CollectionSuite2* collection = nullptr;
  const AEGP_UtilitySuite4* utility = nullptr;
  const AEGP_RegisterSuite5* registrar = nullptr;
  std::vector<SuiteStatus> status;

  // True when AEGP_GetExpression hands back UTF-16 (StreamSuite5 and later); false for 8-bit text (StreamSuite4).
  [[nodiscard]] bool expressionIsUtf16() const { return streamVersion >= kAEGPStreamSuiteVersion5; }

  // Name of the first missing suite, or empty when every suite loaded.
  [[nodiscard]] std::string firstMissing() const;
};

// Never throws. Missing suites are recorded in `status` and left null.
void acquireSuites(const SPBasicSuite* basic, Suites& suites);
void releaseSuites(const SPBasicSuite* basic, Suites& suites);

// {"memory":{"name":"AEGP Memory Suite","version":1,"ok":true},...,"_pluginApi":"1.9"}
// `extra` lists suites that are not needed for reads (the panel experiment's): shown, never required.
std::string suitesJson(const Suites& suites, long apiMajor, long apiMinor, const std::vector<SuiteStatus>& extra = {});

}

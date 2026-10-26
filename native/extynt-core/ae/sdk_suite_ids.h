// One typed id per AEGP suite the plugin asks the host for: the struct type, the SDK's name string and the version. A
// SuiteId is the only thing acquireSuite accepts, and the type of a SuiteId ties each id to one version. Where one slot
// serves several versions, the named cross-version constants below are layout assumptions, each documented where it is
// declared; the type cannot check them.
#pragma once

#include "AE_GeneralPlug.h"
#include "sdk_suites.h"

namespace extynt::ae::suite {

inline constexpr SuiteId<AEGP_MemorySuite1> kMemory{kAEGPMemorySuite, kAEGPMemorySuiteVersion1};
inline constexpr SuiteId<AEGP_ProjSuite5> kProject{kAEGPProjSuite, kAEGPProjSuiteVersion5};
inline constexpr SuiteId<AEGP_ItemSuite8> kItem{kAEGPItemSuite, kAEGPItemSuiteVersion8};
inline constexpr SuiteId<AEGP_CompSuite4> kComp{kAEGPCompSuite, kAEGPCompSuiteVersion4};
inline constexpr SuiteId<AEGP_LayerSuite9> kLayer{kAEGPLayerSuite, kAEGPLayerSuiteVersion9};

// The Stream suite is read through StreamSuite5 (the SDK's v10 layout). Version 9 (StreamSuite4) has the same 22
// members in the same order, and differs only in AEGP_GetExpression's text (8-bit, not UTF-16), which
// Suites::expressionIsUtf16 lets the callers tell apart. Version 11 (StreamSuite6) is the same list plus
// AEGP_GetUniqueStreamID at the end, so the v10 layout is a prefix of it.
inline constexpr SuiteId<AEGP_StreamSuite5> kStream5{kAEGPStreamSuite, kAEGPStreamSuiteVersion5};
inline constexpr SuiteId<AEGP_StreamSuite5> kStream6AsSuite5{kAEGPStreamSuite, kAEGPStreamSuiteVersion6};
inline constexpr SuiteId<AEGP_StreamSuite5> kStream4AsSuite5{kAEGPStreamSuite, kAEGPStreamSuiteVersion4};

inline constexpr SuiteId<AEGP_EffectSuite5> kEffect{kAEGPEffectSuite, kAEGPEffectSuiteVersion5};
inline constexpr SuiteId<AEGP_DynamicStreamSuite4> kDynamicStream{kAEGPDynamicStreamSuite,
                                                                  kAEGPDynamicStreamSuiteVersion4};
inline constexpr SuiteId<AEGP_KeyframeSuite4> kKeyframe{kAEGPKeyframeSuite, kAEGPKeyframeSuiteVersion4};
inline constexpr SuiteId<AEGP_TextDocumentSuite1> kTextDocument{kAEGPTextDocumentSuite, kAEGPTextDocumentSuiteVersion1};
inline constexpr SuiteId<AEGP_MarkerSuite3> kMarker{kAEGPMarkerSuite, kAEGPMarkerSuiteVersion3};
inline constexpr SuiteId<AEGP_MaskOutlineSuite3> kMaskOutline{kAEGPMaskOutlineSuite, kAEGPMaskOutlineSuiteVersion3};
inline constexpr SuiteId<AEGP_CollectionSuite2> kCollection{kAEGPCollectionSuite, kAEGPCollectionSuiteVersion2};

// The Utility suite is read through UtilitySuite4. Version 5 is the same 30 members plus AEGP_UpdateFontList at the
// end, so the v4 layout is a prefix of it.
inline constexpr SuiteId<AEGP_UtilitySuite4> kUtility4{kAEGPUtilitySuite, kAEGPUtilitySuiteVersion4};
inline constexpr SuiteId<AEGP_UtilitySuite4> kUtility5AsSuite4{kAEGPUtilitySuite, kAEGPUtilitySuiteVersion5};
inline constexpr SuiteId<AEGP_UtilitySuite6> kUtility6{kAEGPUtilitySuite, kAEGPUtilitySuiteVersion6};

inline constexpr SuiteId<AEGP_RegisterSuite5> kRegister{kAEGPRegisterSuite, kAEGPRegisterSuiteVersion5};
inline constexpr SuiteId<AEGP_CommandSuite1> kCommand{kAEGPCommandSuite, kAEGPCommandSuiteVersion1};

}

// The exported AEGP entry point. The five-parameter signature is fixed by the host (AEGP_PluginInitFuncPrototype), so
// this is the one function allowed to exceed the parameter limit; it forwards to initializePlugin as one struct.
#include "A.h"
#include "AE_GeneralPlug.h"
#include "SPBasic.h"
#include "sdk_entry.h"

#ifdef _WIN32
#define EXTYNT_EXPORT __declspec(dllexport)
#else
#define EXTYNT_EXPORT __attribute__((visibility("default")))
#endif

extern "C" EXTYNT_EXPORT A_Err EntryPointFunc(struct SPBasicSuite* basic, A_long majorVersion, A_long minorVersion,
                                              AEGP_PluginID pluginId, AEGP_GlobalRefcon* refcon) noexcept {
  return extynt::ae::initializePlugin({basic, majorVersion, minorVersion, pluginId, refcon});
}

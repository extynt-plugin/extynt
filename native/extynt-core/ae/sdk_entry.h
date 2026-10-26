// The AEGP entry point's arguments as one struct. The host calls EntryPointFunc (sdk_entry.cpp) with five loose
// parameters; it forwards them here at once, and everything after that takes this struct.
#pragma once

#include "A.h"
#include "AE_GeneralPlug.h"
#include "SPBasic.h"

namespace extynt::ae {

// What the host passes to AEGP_PluginInitFuncPrototype.
struct PluginEntry {
  const SPBasicSuite* basic;
  A_long majorVersion;
  A_long minorVersion;
  AEGP_PluginID pluginId;
  AEGP_GlobalRefcon* refcon;
};

// Sets the plugin up for one host load. Defined in ae_entry.cpp; it catches everything and always returns A_Err_NONE.
A_Err initializePlugin(const PluginEntry& entry) noexcept;

}

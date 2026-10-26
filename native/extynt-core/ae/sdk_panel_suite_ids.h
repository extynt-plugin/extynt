// The typed ids of the suites only the native panel asks for (see sdk_suite_ids.h). Separate because
// AE_GeneralPlugPanels.h needs the platform view types the panel sources define first.
#pragma once

#include "AE_EffectSuites.h"
#include "AE_GeneralPlugPanels.h"
#include "sdk_suites.h"

namespace extynt::ae::suite {

inline constexpr SuiteId<AEGP_PanelSuite1> kPanel{kAEGPPanelSuite, kAEGPPanelSuiteVersion1};
inline constexpr SuiteId<PFAppSuite4> kApp{kPFAppSuite, kPFAppSuiteVersion4};

}

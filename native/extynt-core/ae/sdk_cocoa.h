// Converts between the SDK's panel refcon and a retained Cocoa object. The SDK stores the refcon as an opaque struct
// pointer; this is the only place an Objective-C object becomes one and back.
#pragma once

#import <Cocoa/Cocoa.h>

#include "AE_GeneralPlugPanels.h"

@class extyntPanel;

namespace extynt::ae {

// Transfers a +1 retain of `panel` into the refcon the host keeps. CFBridgingRetain returns a const CFTypeRef and the
// SDK's refcon is a non-const struct pointer, so the const is cast away here; the host only hands the pointer back,
// never writes through it.
inline AEGP_PanelRefcon retainAsRefcon(extyntPanel* panel) {
  return const_cast<AEGP_PanelRefcon>(static_cast<const _AEGP_PanelRefcon*>(CFBridgingRetain(panel)));
}

// The panel a refcon made by retainAsRefcon refers to. ARC holds it for the caller's statement, and the refcon's own
// retain is untouched.
inline extyntPanel* panelFromRefcon(AEGP_PanelRefcon refcon) {
  return static_cast<extyntPanel*>(CFBridgingRelease(CFRetain(static_cast<CFTypeRef>(refcon))));
}

}

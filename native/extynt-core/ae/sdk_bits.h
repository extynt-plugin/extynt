// The SDK's payload unions carry no tag the compiler can see; each accessor names the member the caller knows is
// active and reads it directly.
#pragma once

#include "AE_Effect.h"
#include "AE_GeneralPlug.h"

namespace extynt::ae {

// The layer a collection item of layer type holds.
inline const AEGP_LayerCollectionItem& layerItem(const AEGP_CollectionItemV2& item) { return item.u.layer; }

// The popup parameter definition of a parameter known to be a popup.
inline const PF_PopupDef& popupDef(const PF_ParamDefUnion& def) { return def.pd; }

// The '|'-separated choice names of a popup definition; null when it has none.
inline const char* popupChoiceNames(const PF_PopupDef& popup) { return popup.u.PF_DEF_NAMESPTR; }

}

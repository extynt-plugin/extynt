// Converts between the core's strong references (LayerRef, StreamRef) and the AEGP handles they stand for. A handle is
// a pointer and a reference points at an opaque token, so each direction is a pointer conversion; each has its own
// named accessor so a layer handle can never be read back as a stream.
#pragma once

#include "AE_GeneralPlug.h"
#include "host_reader.h"

namespace extynt::ae {

// The reference standing for a layer handle.
inline LayerRef layerRef(AEGP_LayerH layer) { return LayerRef{reinterpret_cast<LayerToken*>(layer)}; }

// The layer handle a reference was made from.
inline AEGP_LayerH layerHandle(LayerRef ref) { return reinterpret_cast<AEGP_LayerH>(ref.value); }

// The reference standing for a stream handle.
inline StreamRef streamRef(AEGP_StreamRefH stream) { return StreamRef{reinterpret_cast<StreamToken*>(stream)}; }

// The stream handle a reference was made from.
inline AEGP_StreamRefH streamHandle(StreamRef ref) { return reinterpret_cast<AEGP_StreamRefH>(ref.value); }

}

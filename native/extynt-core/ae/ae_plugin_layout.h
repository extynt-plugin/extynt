// Where After Effects loads effect plug-ins from on this machine, for the Options-dialog scan
// (transport/plugin_files.h): the Plug-ins folder next to the application and Adobe's shared Common/Plug-ins folder.
// One implementation per platform (ae_plugin_layout_win.cpp, ae_plugin_layout_mac.cpp).
#pragma once

#include "plugin_files.h"

namespace extynt::ae {

PluginLayout hostPluginLayout();

}

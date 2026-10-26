// The catalogue window's program, which the platform's wWinMain in sdk_win_catalogue.cpp runs once DPI awareness is
// set.
#pragma once

#include <windows.h>

namespace extynt::catalogue {

int runCatalogueProgram(HINSTANCE instance);

}

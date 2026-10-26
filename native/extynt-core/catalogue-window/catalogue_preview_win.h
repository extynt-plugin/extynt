// Windows only: the two preview modes of the catalogue window that write files or read the command line. The
// screenshots mode writes one PNG of the page per canned state and theme, at 2x, as the Mac preview's pane mode does.
#pragma once

#include <optional>
#include <string>
#include <vector>

#include "catalogue_text.h"

namespace extynt::catalogue {

std::optional<bool> themeArgument(const std::vector<std::wstring>& arguments, std::size_t index);

// The language named by the argument at `index` ("de", "zh-Hans", ...); English when there is none or it is unknown.
Language languageArgument(const std::vector<std::wstring>& arguments, std::size_t index);

int runPreviewScreenshots(const std::vector<std::wstring>& arguments);

}

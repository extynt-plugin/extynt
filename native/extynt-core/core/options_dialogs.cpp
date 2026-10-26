// Finds, per installed effect plug-in, whether its PiPL declares an Options dialog, caching by file stamp.

#include "options_dialogs.h"

#include <algorithm>
#include <cstddef>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "pipl.h"

namespace extynt {

std::vector<EffectDialogFlag> scanOptionsDialogs(PiplSource& source) {
  std::map<std::string, bool> found;
  const std::vector<std::string> files = source.pluginFiles();
  const size_t limit = std::min(files.size(), kMaxPluginFiles);
  for (size_t i = 0; i < limit && found.size() < kMaxScannedEffects; ++i) {
    for (const std::string& resource : source.readPipls(files[i])) {
      const std::optional<PiplEffect> effect = parsePipl(resource);
      if (effect) found.emplace(effect->matchName, flagsHaveOptionsDialog(effect->globalOutFlags));
    }
  }
  std::vector<EffectDialogFlag> rows;
  rows.reserve(found.size());
  for (const auto& [name, hasDialog] : found) rows.push_back(EffectDialogFlag{name, hasDialog});
  return rows;
}

}

// Which installed effects have an Options dialog (PF_OutFlag_I_DO_DIALOG in their PiPL), found from the plug-in files
// themselves. A prediction only: whether adding the effect opens a dialog is decided at run time (the live detection in
// dialog_probe.h is the certainty). The file system and the PiPL container are behind PiplSource, one per platform.
#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace extynt {

constexpr size_t kMaxPluginFiles = 20000;
constexpr size_t kMaxScannedEffects = 10000;

struct EffectDialogFlag {
  std::string matchName;
  bool hasOptionsDialog = false;
};

class PiplSource {
 public:
  PiplSource() = default;
  virtual ~PiplSource() = default;
  PiplSource(const PiplSource&) = delete;
  PiplSource& operator=(const PiplSource&) = delete;
  PiplSource(PiplSource&&) = delete;
  PiplSource& operator=(PiplSource&&) = delete;

  // The plug-in files After Effects loads effects from (paths as the platform spells them).
  virtual std::vector<std::string> pluginFiles() = 0;
  // The bytes of each 'PiPL' resource in one plug-in file; empty when it has none or cannot be read.
  virtual std::vector<std::string> readPipls(const std::string& file) = 0;
};

// Every effect found, sorted by match name, one row per match name (a name seen twice keeps the flag of the first
// file). Effects the scan did not find are absent: absence is "unknown", never "no dialog".
std::vector<EffectDialogFlag> scanOptionsDialogs(PiplSource& source);

}

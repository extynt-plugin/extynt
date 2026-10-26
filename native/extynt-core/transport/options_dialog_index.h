// The Options-dialog scan (core/options_dialogs.h) run once on a background thread when the plug-in loads, so reading a
// few hundred plug-in files never holds After Effects' main thread. The census asks for the result and gets nothing
// until the scan finished.
#pragma once

#include <atomic>
#include <memory>
#include <mutex>
#include <optional>
#include <thread>
#include <vector>

#include "options_dialogs.h"

namespace extynt {

class OptionsDialogIndex {
 public:
  explicit OptionsDialogIndex(std::unique_ptr<PiplSource> source);
  ~OptionsDialogIndex();
  OptionsDialogIndex(const OptionsDialogIndex&) = delete;
  OptionsDialogIndex& operator=(const OptionsDialogIndex&) = delete;
  OptionsDialogIndex(OptionsDialogIndex&&) = delete;
  OptionsDialogIndex& operator=(OptionsDialogIndex&&) = delete;

  // Any thread. Nothing while the scan runs or after it failed: a failed scan means "unknown", never "no dialogs".
  [[nodiscard]] std::optional<std::vector<EffectDialogFlag>> snapshot() const;
  // Any thread. True only while the scan is still running, so a census asked now knows to ask again later.
  [[nodiscard]] bool pending() const { return !finished_.load(); }

 private:
  void run();

  std::unique_ptr<PiplSource> source_;
  std::atomic<bool> stop_{false};
  std::atomic<bool> finished_{false};
  mutable std::mutex mutex_;
  std::optional<std::vector<EffectDialogFlag>> result_;
  std::thread worker_;
};

}

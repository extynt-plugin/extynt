// Background scan that indexes which effects open an options dialog.
#include "options_dialog_index.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "options_dialogs.h"

namespace extynt {

namespace {

class StoppableSource : public PiplSource {
 public:
  StoppableSource(PiplSource& inner, const std::atomic<bool>& stop) : inner_(inner), stop_(stop) {}
  std::vector<std::string> pluginFiles() override { return inner_.pluginFiles(); }
  std::vector<std::string> readPipls(const std::string& file) override {
    return stop_.load() ? std::vector<std::string>{} : inner_.readPipls(file);
  }

 private:
  PiplSource& inner_;
  const std::atomic<bool>& stop_;
};

}

OptionsDialogIndex::OptionsDialogIndex(std::unique_ptr<PiplSource> source) : source_(std::move(source)) {
  worker_ = std::thread([this] { run(); });
}

OptionsDialogIndex::~OptionsDialogIndex() {
  stop_.store(true);
  if (worker_.joinable()) worker_.join();
}

void OptionsDialogIndex::run() {
  try {
    StoppableSource guarded(*source_, stop_);
    std::vector<EffectDialogFlag> rows = scanOptionsDialogs(guarded);
    if (!stop_.load()) {
      const std::scoped_lock lock(mutex_);
      result_ = std::move(rows);
    }
  } catch (...) {
    const std::scoped_lock lock(mutex_);
    result_.reset();
  }
  finished_.store(true);
}

std::optional<std::vector<EffectDialogFlag>> OptionsDialogIndex::snapshot() const {
  const std::scoped_lock lock(mutex_);
  return result_;
}

}

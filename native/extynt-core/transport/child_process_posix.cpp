// Starts and reaps the sidecar process with posix_spawn: a fixed minimal environment, only the three standard
// descriptors inherited.
#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cerrno>
#include <csignal>
#include <memory>
#include <string>
#include <vector>

#include "child_process.h"
#include "errno_text.h"

namespace extynt {

struct ChildProcess::State {
  pid_t pid = 0;
};

namespace {

class SpawnSetup {
 public:
  SpawnSetup() {
    posix_spawnattr_init(&attributes_);
    posix_spawn_file_actions_init(&actions_);
#ifdef POSIX_SPAWN_CLOEXEC_DEFAULT
    posix_spawnattr_setflags(&attributes_, POSIX_SPAWN_CLOEXEC_DEFAULT);
#endif
    posix_spawn_file_actions_addopen(&actions_, STDIN_FILENO, "/dev/null", O_RDONLY, 0);
    posix_spawn_file_actions_addopen(&actions_, STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
    posix_spawn_file_actions_addopen(&actions_, STDERR_FILENO, "/dev/null", O_WRONLY, 0);
  }
  ~SpawnSetup() {
    posix_spawn_file_actions_destroy(&actions_);
    posix_spawnattr_destroy(&attributes_);
  }
  SpawnSetup(const SpawnSetup&) = delete;
  SpawnSetup& operator=(const SpawnSetup&) = delete;
  SpawnSetup(SpawnSetup&&) = delete;
  SpawnSetup& operator=(SpawnSetup&&) = delete;

  [[nodiscard]] const posix_spawn_file_actions_t* actions() const { return &actions_; }
  [[nodiscard]] const posix_spawnattr_t* attributes() const { return &attributes_; }

 private:
  posix_spawnattr_t attributes_{};
  posix_spawn_file_actions_t actions_{};
};

int spawnChild(const std::string& program, const std::vector<std::string>& arguments, pid_t& pid) {
  std::vector<std::string> storage = arguments;
  std::vector<char*> argv;
  argv.reserve(storage.size() + 1);
  for (std::string& argument : storage) argv.push_back(argument.data());
  argv.push_back(nullptr);
  std::string path = "PATH=/usr/bin:/bin:/usr/sbin:/sbin";
  std::vector<char*> environment{path.data(), nullptr};
  const SpawnSetup setup;
  return posix_spawn(&pid, program.c_str(), setup.actions(), setup.attributes(), argv.data(), environment.data());
}

int exitCodeOf(int status) { return WIFEXITED(status) ? WEXITSTATUS(status) : -1; }

}

ChildProcess::ChildProcess() : state_(std::make_unique<State>()) {}
ChildProcess::~ChildProcess() = default;

bool ChildProcess::spawn(const std::string& program, const std::vector<std::string>& arguments, std::string& error) {
  const int spawnError = spawnChild(program, arguments, state_->pid);
  if (spawnError == 0) return true;
  error = "posix_spawn " + program + ": " + errnoText(spawnError);
  return false;
}

ChildState ChildProcess::poll(int& exitCode) {
  int status = 0;
  const pid_t ended = ::waitpid(state_->pid, &status, WNOHANG);
  if (ended == state_->pid) {
    exitCode = exitCodeOf(status);
    return ChildState::Exited;
  }
  if (ended < 0 && errno != EINTR) return ChildState::Lost;
  return ChildState::Running;
}

void ChildProcess::killAndReap() {
  int status = 0;
  ::kill(state_->pid, SIGKILL);
  ::waitpid(state_->pid, &status, 0);
}

}

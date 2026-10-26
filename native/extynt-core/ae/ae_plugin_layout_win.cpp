// Windows plug-in layout: <AE>\Support Files\Plug-ins (next to AfterFX.exe, which is scanned too for the effects built
// into it) and %ProgramFiles%\Adobe\Common\Plug-ins. A .aex's PiPL is read with LoadLibraryEx as a data file: the
// DLL is mapped for its resources only, its DllMain never runs and its imports are never loaded.
#include <windows.h>

#include <string>
#include <string_view>
#include <vector>

#include "ae_host_executable_win.h"
#include "ae_plugin_layout.h"
#include "pipl.h"
#include "sdk_win_module.h"
#include "windows_paths.h"

namespace extynt::ae {

namespace {

constexpr size_t kMaxPiplsPerFile = 64;

std::vector<std::string> readPiplResources(const std::string& file) {
  std::vector<std::string> out;
  const HMODULE module = LoadLibraryExW(win::widen(file).c_str(), nullptr, LOAD_LIBRARY_AS_DATAFILE);
  if (module == nullptr) return out;
  sdkwin::forEachResourceName(module, L"PIPL", [&out](HMODULE owner, LPCWSTR type, LPWSTR name) {
    if (out.size() >= kMaxPiplsPerFile) return false;
    const std::string_view bytes = sdkwin::resourceBytes(owner, type, name);
    if (!bytes.empty() && bytes.size() <= kMaxPiplBytes) out.emplace_back(bytes);
    return true;
  });
  FreeLibrary(module);
  return out;
}

std::string parentOf(const std::string& path) {
  const size_t slash = path.find_last_of("/\\");
  return slash == std::string::npos ? "" : path.substr(0, slash);
}

}

PluginLayout hostPluginLayout() {
  PluginLayout layout;
  layout.kind = PluginKind::Aex;
  layout.readFile = readPiplResources;
  const std::string executable = win::narrow(hostExecutablePath());
  if (!executable.empty()) {
    layout.roots.push_back(parentOf(executable) + "/Plug-ins");
    layout.roots.push_back(executable);
  }
  const std::string programFiles = win::environmentVariable("ProgramFiles");
  if (!programFiles.empty()) layout.roots.push_back(programFiles + "/Adobe/Common/Plug-ins");
  return layout;
}

}

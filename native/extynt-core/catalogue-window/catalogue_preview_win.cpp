// The catalogue window's screenshot preview: the page in each canned state (after the entering state), one PNG per
// state and theme at 2x, written with the GDI+ PNG encoder. The progress bar is stepped until it has finished easing,
// as after the Mac's pause. See catalogue_preview_win.h.
#include "catalogue_preview_win.h"

#include <windows.h>
#include <objidl.h>

#include <algorithm>
#include <cwchar>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include <gdiplus.h>

#include "canned_status.h"
#include "catalogue_status.h"
#include "catalogue_view_win.h"
#include "windows_paths.h"

namespace extynt::catalogue {

namespace {

constexpr int kEasingTicks = 60;
constexpr double kTickSeconds = 0.016;
constexpr float kScreenshotScale = 2.0F;
constexpr double kClockStart = 100;
constexpr std::size_t kThemeArgumentIndex = 2;
constexpr std::size_t kLanguageArgumentIndex = 3;

bool pngEncoder(CLSID& clsid) {
  UINT count = 0;
  UINT bytes = 0;
  if (Gdiplus::GetImageEncodersSize(&count, &bytes) != Gdiplus::Ok || bytes == 0) return false;
  std::vector<Gdiplus::ImageCodecInfo> encoders((bytes + sizeof(Gdiplus::ImageCodecInfo) - 1) /
                                                sizeof(Gdiplus::ImageCodecInfo));
  if (Gdiplus::GetImageEncoders(count, bytes, encoders.data()) != Gdiplus::Ok) return false;
  for (UINT index = 0; index < count; index++) {
    if (std::wcscmp(encoders[index].MimeType, L"image/png") == 0) {
      clsid = encoders[index].Clsid;
      return true;
    }
  }
  return false;
}

struct Shot {
  std::wstring directory;
  std::wstring theme;
  CLSID encoder;
  Language language;
};

bool saveShot(CatalogueView& view, double& clock, const Shot& shot, const std::wstring& name) {
  for (int tick = 0; tick < kEasingTicks; tick++) view.step(clock += kTickSeconds);
  const std::unique_ptr<Gdiplus::Bitmap> bitmap = view.render(kScreenshotScale, clock, false);
  const std::wstring path = shot.directory + L"\\catalogue-" + shot.theme + L"-" + name + L".png";
  return bitmap->Save(path.c_str(), &shot.encoder, nullptr) == Gdiplus::Ok;
}

bool writeTheme(const Shot& shot) {
  CatalogueView view;
  view.setDark(shot.theme == L"dark");
  view.page.language = shot.language;
  view.page.showStarting();
  view.syncBar();
  double clock = kClockStart;
  std::vector<std::pair<std::wstring, const Status*>> states = {{L"0-entering", nullptr}};
  const std::vector<CannedStatus> canned = cannedStatuses(shot.language);
  for (const CannedStatus& entry : canned) states.emplace_back(win::widen(entry.name), &entry.status);
  for (const auto& [name, status] : states) {
    if (status) view.page.render(*status);
    view.syncBar();
    if (!saveShot(view, clock, shot, name)) return false;
  }
  return true;
}

int writeScreenshots(const std::wstring& directory, const std::vector<std::wstring>& themes, Language language) {
  CLSID png;
  if (!pngEncoder(png)) return 1;
  CreateDirectoryW(directory.c_str(), nullptr);
  for (const std::wstring& theme : themes) {
    if (!writeTheme({directory, theme, png, language})) return 1;
  }
  return 0;
}

}

std::optional<bool> themeArgument(const std::vector<std::wstring>& arguments, std::size_t index) {
  if (index >= arguments.size()) return std::nullopt;
  if (arguments[index] == L"dark") return true;
  if (arguments[index] == L"light") return false;
  return std::nullopt;
}

Language languageArgument(const std::vector<std::wstring>& arguments, std::size_t index) {
  if (index >= arguments.size()) return Language::En;
  return languageFromCode(win::narrow(arguments[index]));
}

int runPreviewScreenshots(const std::vector<std::wstring>& arguments) {
  if (arguments.size() < 2) return 2;
  const std::optional<bool> only = themeArgument(arguments, kThemeArgumentIndex);
  std::vector<std::wstring> themes = {L"light", L"dark"};
  if (only) themes = {*only ? L"dark" : L"light"};
  return writeScreenshots(arguments[1], themes, languageArgument(arguments, kLanguageArgumentIndex));
}

}

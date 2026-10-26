// The catalogue window's start-up helpers: see catalogue_launch_win.h.
#include "catalogue_launch_win.h"

#include <windows.h>
#include <objidl.h>
#include <shellapi.h>

#include <string>
#include <vector>

#include <gdiplus.h>

#include "sdk_win_catalogue.h"

namespace extynt::catalogue {

std::vector<std::wstring> commandLineArguments() {
  int count = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &count);
  std::vector<std::wstring> arguments;
  for (int index = 1; argv && index < count; index++) arguments.emplace_back(argv[index]);
  if (argv) sdkcatalogue::freeArguments(argv);
  return arguments;
}

bool firstArgumentIs(const std::vector<std::wstring>& arguments, const wchar_t* flag) {
  return !arguments.empty() && arguments[0] == flag;
}

GdiplusSession::GdiplusSession() {
  const Gdiplus::GdiplusStartupInput input;
  Gdiplus::GdiplusStartup(&token_, &input, nullptr);
}

GdiplusSession::~GdiplusSession() { Gdiplus::GdiplusShutdown(token_); }

}

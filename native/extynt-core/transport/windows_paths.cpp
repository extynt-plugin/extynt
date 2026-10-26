// Windows known-folder lookups as UTF-8 paths with forward slashes.
#include "windows_paths.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <knownfolders.h>
#include <shlobj.h>

#include <string>
#include <vector>

namespace extynt::win {

namespace {

std::string knownFolder(const KNOWNFOLDERID& id) {
  PWSTR raw = nullptr;
  if (FAILED(::SHGetKnownFolderPath(id, KF_FLAG_DONT_VERIFY, nullptr, &raw)) || raw == nullptr) {
    ::CoTaskMemFree(raw);
    return "";
  }
  std::string path = narrow(raw);
  ::CoTaskMemFree(raw);
  for (char& c : path)
    if (c == '\\') c = '/';
  return path;
}

}

std::wstring widen(const std::string& utf8) {
  if (utf8.empty()) return L"";
  const int size = ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
  if (size <= 0) return L"";
  std::wstring wide(static_cast<size_t>(size), L'\0');
  ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(), size);
  return wide;
}

std::string narrow(const std::wstring& wide) {
  if (wide.empty()) return "";
  const int size =
      ::WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return "";
  std::string text(static_cast<size_t>(size), '\0');
  ::WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), text.data(), size, nullptr, nullptr);
  return text;
}

std::string localAppDataDirectory() { return knownFolder(FOLDERID_LocalAppData); }
std::string programDataDirectory() { return knownFolder(FOLDERID_ProgramData); }
std::string profileDirectory() { return knownFolder(FOLDERID_Profile); }

std::string environmentVariable(const std::string& name) {
  const std::wstring wideName = widen(name);
  const DWORD size = ::GetEnvironmentVariableW(wideName.c_str(), nullptr, 0);
  if (size == 0) return "";
  std::vector<wchar_t> value(size);
  const DWORD copied = ::GetEnvironmentVariableW(wideName.c_str(), value.data(), size);
  return narrow(std::wstring(value.data(), copied));
}

std::string stateDirectoryPath() {
  const std::string base = localAppDataDirectory();
  return base.empty() ? "" : base + "/extynt";
}

}

// Windows only: what the catalogue window's program needs before a window exists: the command-line arguments after the
// program name, a test for the first one, and GDI+ started for as long as a GdiplusSession lives.
#pragma once

#include <windows.h>

#include <string>
#include <vector>

namespace extynt::catalogue {

std::vector<std::wstring> commandLineArguments();
bool firstArgumentIs(const std::vector<std::wstring>& arguments, const wchar_t* flag);

class GdiplusSession {
 public:
  GdiplusSession();
  ~GdiplusSession();
  GdiplusSession(const GdiplusSession&) = delete;
  GdiplusSession& operator=(const GdiplusSession&) = delete;
  GdiplusSession(GdiplusSession&&) = delete;
  GdiplusSession& operator=(GdiplusSession&&) = delete;

 private:
  ULONG_PTR token_ = 0;
};

}

// Minimal stand-in for <mach-o/dyld.h>: the executable path, with the real signature. NOT the Apple SDK.
#pragma once
#include <stdint.h>
extern "C" int _NSGetExecutablePath(char* buf, uint32_t* bufsize);

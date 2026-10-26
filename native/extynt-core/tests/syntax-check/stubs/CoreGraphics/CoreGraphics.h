// Minimal stand-in for CoreGraphics.h: only what native/extynt-core/ae uses, with the real signatures.
// For a Linux syntax check; it is NOT the Apple SDK.
#pragma once
#include <CoreFoundation/CoreFoundation.h>
typedef uint32_t CGWindowID;
typedef uint32_t CGWindowListOption;
enum : CGWindowListOption { kCGWindowListOptionOnScreenOnly = (1 << 0), kCGWindowListExcludeDesktopElements = (1 << 4) };
#define kCGNullWindowID ((CGWindowID)0)
extern "C" const CFStringRef kCGWindowOwnerPID;
extern "C" const CFStringRef kCGWindowLayer;
extern "C" const CFStringRef kCGWindowName;
extern "C" CFArrayRef CGWindowListCopyWindowInfo(CGWindowListOption option, CGWindowID relativeToWindow);

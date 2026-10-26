// Objective-C++ only. State shared by the native-panel files (flyout switches, the live web views) and the text
// helpers the key and mouse log lines are built from. Main thread only, except the atomics.
#pragma once

#import <Cocoa/Cocoa.h>

#include <atomic>
#include <string>

namespace extynt::ae::panel {

// Flyout: "Log keys" (on by default while the panel is verified on a Mac).
extern std::atomic<bool> g_logKeys;
extern std::atomic<int> g_createCount;

// Every live web view (weak references, so a destroyed panel drops out by itself). Main thread only.
NSHashTable* liveViews();

std::string stdString(NSString* text);
std::string className(id object);
const char* yesNo(BOOL value);
// Quoted, with everything outside printable ASCII shown as \uXXXX (arrow keys are U+F700.., Escape is U+001B, ...).
std::string escapedChars(NSString* text);
std::string modifierText(NSEventModifierFlags flags);
// What a window is, for the key log: the facts that decide whether it can take keys and clicks.
std::string windowText(NSWindow* window);

}

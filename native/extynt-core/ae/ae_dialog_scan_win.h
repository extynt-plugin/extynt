// Windows only. Finds the modal dialog this process is showing by reading window state alone: a dialog is an enabled,
// visible window whose owner is disabled, and the owner chain ends at After Effects' main window. No SDK call is made,
// so it is safe from a socket thread.
#pragma once

#include <windows.h>

#include <string>

namespace extynt::ae {

// True for a window of the standard dialog class.
bool isDialogWindow(HWND window);

// The modal dialog of this process, preferring a dialog-class window; a dialog with no owner counts only while some
// other window of the process is disabled. Null when none is open.
HWND findModalDialogWindow();

// The dialog's title, fetched with a timed WM_GETTEXT so a main thread that does not pump messages cannot hold the
// caller.
std::string dialogTitle(HWND dialog);

}

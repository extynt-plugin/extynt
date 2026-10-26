// The few things that differ per OS: the host version text, the CPU name, how the sidecar is started. One
// implementation per platform (ae_platform_mac.cpp, ae_platform_win.cpp).
#pragma once

#include <string>

#include "ae_sdk.h"
#include "launch_agent.h"

namespace extynt::ae {

// "26.5.0 (build 61)" style text for the host application that loaded the plugin.
std::string hostVersionString();

// True only in the catalogue engine, an After Effects the sidecar started with `-noui -extynt_engine`: the plugin is
// then the catalogue's worker, with its own discovery file and no sidecar start. aerender and a plain -noui session
// are not the engine. Decided by core/host_mode. Windows also reads EXTYNT_ENGINE=1 from the environment, since After
// Effects rewrites its own command line there before the plugin loads.
bool hostIsHeadless();

// Engine mode only: keeps a full After Effects launched hidden as the catalogue's engine out of sight (no Dock icon,
// never the active app, no visible window). Repeated from the idle hook because After Effects resets it. Main thread.
// Windows: hides this process's windows and takes them off the taskbar (as tool windows), activating nothing; a modal
// dialog is left to the guard below. It also makes a crash end the process at once, so neither the Adobe crash report
// window nor a Windows error box opens.
void keepEngineOutOfSight();

// Engine mode only: cancels any modal dialog within a quarter second, so an effect that opens one while it is tested
// cannot hold the hidden engine. Main thread, once. Windows: a thread of its own (the dialog's modal loop holds the
// main thread) that posts Cancel, then Close, to the dialog.
void startEngineDialogGuard();

// Engine mode only: keeps a plug-in's network listener on this computer, so the firewall never asks the user about the
// hidden After Effects. Main thread, once. Windows: binds to a network address with a fixed port are moved to loopback
// (ae_engine_network_win.cpp). macOS: nothing to do; the application firewall does not ask about a signed app.
void keepEngineListenersLocal();

// "arm64" or "x86_64": the CPU the plugin was built for.
const char* hostArchitecture();

// Starts the sidecar's own autostart job (launchd kickstart on macOS, the "extynt sidecar" Scheduled Task on Windows)
// on `kickstart`'s thread and logs the outcome. Returns at once; a running sidecar is left alone.
void startSidecar(Kickstart& kickstart);

// True while After Effects shows a modal dialog (a startup report, Preferences, an alert). A script run then fails and
// AE reports it in a dialog of its own, so the reader must not run one. Windows: AE's main window is disabled under a
// modal; macOS: NSApp has a modal window. Main thread only.
bool hostModalDialogOpen(const AEGP_UtilitySuite4& utility);

}

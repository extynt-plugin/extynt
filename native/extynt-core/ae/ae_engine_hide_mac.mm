// Keeps the full After Effects the sidecar starts as the catalogue's engine (hidden, -noui) out of sight and moving. It
// is a regular app, so on its own it gets a Dock icon, takes the menu bar when a project opens and shows a window; and
// an effect that opens a dialog while it is tested would hold it for good, since no one can see the dialog to answer
// it. Engine mode only, never in the After Effects the user works in. Main thread.
#import <Cocoa/Cocoa.h>

#include <string>

#include "ae_log.h"
#include "ae_platform.h"

namespace extynt::ae {

void keepEngineOutOfSight() {
  NSApplication* app = NSApp;
  if (app == nil) return;
  if (app.activationPolicy != NSApplicationActivationPolicyProhibited) {
    const bool changed = [app setActivationPolicy:NSApplicationActivationPolicyProhibited];
    logLine(std::string("engine: background-only app ") + (changed ? "set" : "refused"));
  }
  if (app.active) [app deactivate];
  for (NSWindow* window in app.windows) {
    if (window.visible) [window orderOut:nil];
  }
}

namespace {

NSTimer* g_dialogTimer = nil;

void cancelEngineDialog() {
  NSWindow* modal = NSApp.modalWindow;
  if (modal == nil) return;
  logLine(std::string("engine: cancelled a dialog an effect opened: ") +
          (modal.title.length > 0 ? modal.title.UTF8String : "(untitled)"));
  [NSApp abortModal];
}

}

void keepEngineListenersLocal() {}

void startEngineDialogGuard() {
  if (g_dialogTimer != nil) return;
  g_dialogTimer = [NSTimer timerWithTimeInterval:0.25 repeats:YES block:^(NSTimer*) { cancelEngineDialog(); }];
  [[NSRunLoop mainRunLoop] addTimer:g_dialogTimer forMode:NSRunLoopCommonModes];
  logLine("engine: dialog guard on");
}

}

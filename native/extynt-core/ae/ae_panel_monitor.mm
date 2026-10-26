// The event monitor. One NSEvent local monitor for the whole process. Local monitors run inside NSApplication's event
// dispatch, before the event reaches a window, a menu key equivalent or a view. If AE intercepts some keys earlier than
// that (its own sendEvent: override, say), those keys never show up here: the key log then has no line for them, which
// is itself the answer. Lines for a key that did get here say which route it took.
#import "ae_panel_monitor.h"

#import <Cocoa/Cocoa.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <optional>
#include <string>

#include "ae_log.h"
#include "ae_panel_diag.h"
#include "ae_panel_view.h"
#include "panel_menu.h"

using extynt::ae::logLine;

namespace extynt::ae::panel {

namespace {

id g_monitor = nil;
__weak NSResponder* g_previousResponder = nil;
constexpr size_t kRoutedRing = 4;
std::array<extynt::ae::KeyStamp, kRoutedRing> g_routed;
size_t g_routedNext = 0;

extynt::ae::KeyStamp stampOf(NSEvent* event) {
  extynt::ae::KeyStamp stamp;
  stamp.timestamp = event.timestamp;
  stamp.keyCode = event.keyCode;
  stamp.type = event.type;
  stamp.windowNumber = event.windowNumber;
  stamp.valid = true;
  return stamp;
}

extyntWebView* webViewContaining(NSResponder* responder) {
  if (![responder isKindOfClass:[NSView class]]) return nil;
  for (extyntWebView* web in liveViews().allObjects) {
    if (responder == web || [static_cast<NSView*>(responder) isDescendantOf:web]) return web;
  }
  return nil;
}

BOOL windowHostsAWebView(NSWindow* window) {
  for (extyntWebView* web in liveViews().allObjects) {
    if (web.window == window) return YES;
  }
  return NO;
}

void rememberRouted(NSEvent* event) {
  g_routed[g_routedNext] = stampOf(event);
  g_routedNext = (g_routedNext + 1) % kRoutedRing;
}

bool isResend(NSEvent* event) {
  const extynt::ae::KeyStamp now = stampOf(event);
  return std::any_of(g_routed.begin(), g_routed.end(), [&now](const extynt::ae::KeyStamp& routed) {
    return extynt::ae::isResendOfRoutedKey(routed, now);
  });
}

enum class Route { Action, Deliver, Pass };

enum : unsigned short {
  kKeyLeft = 123,
  kKeyRight = 124,
  kKeyDown = 125,
  kKeyUp = 126,
  kKeyBackspace = 51,
  kKeyForwardDelete = 117
};

struct KeyAction {
  SEL action = nullptr;
  NSString* jsFallback = nil;
};

bool isNavigationOrDeleteKey(unsigned short code) {
  return code == kKeyLeft || code == kKeyRight || code == kKeyDown || code == kKeyUp || code == kKeyBackspace ||
         code == kKeyForwardDelete;
}

bool commandAction(NSString* key, BOOL shift, KeyAction* out) {
  if (shift) {
    if (![key isEqualToString:@"z"]) return false;
    *out = {@selector(redo:), @"document.execCommand('redo')"};
    return true;
  }
  if ([key isEqualToString:@"c"]) *out = {@selector(copy:), @"document.execCommand('copy')"};
  else if ([key isEqualToString:@"v"]) *out = {@selector(paste:), nil};
  else if ([key isEqualToString:@"x"]) *out = {@selector(cut:), @"document.execCommand('cut')"};
  else if ([key isEqualToString:@"a"]) *out = {@selector(selectAll:), @"document.execCommand('selectAll')"};
  else if ([key isEqualToString:@"z"]) *out = {@selector(undo:), @"document.execCommand('undo')"};
  else return false;
  return true;
}

bool editingKeyAction(NSEvent* event, BOOL shift, KeyAction* out) {
  const std::optional<extynt::ae::EditingKeyCommand> command = extynt::ae::editingKeyCommand(event.keyCode, shift);
  if (!command) return false;
  out->action = NSSelectorFromString([NSString stringWithUTF8String:command->selector.c_str()]);
  out->jsFallback = command->jsFallback.empty() ? nil : [NSString stringWithUTF8String:command->jsFallback.c_str()];
  return true;
}

Route classifyCommandKey(NSEvent* event, BOOL shift, KeyAction* out) {
  NSString* key = [event.charactersIgnoringModifiers lowercaseString];
  if (commandAction(key, shift, out)) return Route::Action;
  return isNavigationOrDeleteKey(event.keyCode) ? Route::Deliver : Route::Pass;
}

Route classify(NSEvent* event, KeyAction* out) {
  const NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  const BOOL command = (flags & NSEventModifierFlagCommand) != 0, control = (flags & NSEventModifierFlagControl) != 0;
  const BOOL option = (flags & NSEventModifierFlagOption) != 0, shift = (flags & NSEventModifierFlagShift) != 0;
  if (!command && !control) return (!option && editingKeyAction(event, shift, out)) ? Route::Action : Route::Deliver;
  if (!command || control || option) return Route::Pass;
  return classifyCommandKey(event, shift, out);
}

std::string performAction(extyntWebView* web, NSResponder* responder, const KeyAction& act) {
  const std::string name = stdString(NSStringFromSelector(act.action));
  for (NSResponder* candidate = responder; candidate; candidate = candidate.nextResponder) {
    if ([candidate respondsToSelector:act.action]) {
      const BOOL sent = [NSApp sendAction:act.action to:candidate from:web];
      return "monitor-action(" + name + " -> " + className(candidate) + (sent ? "" : ", not performed") + ")";
    }
    if (candidate == web) break;
  }
  if (act.jsFallback) {
    [web evaluateJavaScript:act.jsFallback completionHandler:nil];
    return "monitor-action(" + name + " -> no responder inside, page JS fallback)";
  }
  return "monitor-action(" + name + " -> nothing inside answers, swallowed)";
}

struct KeyContext {
  NSEvent* event = nil;
  NSWindow* window = nil;
  NSResponder* responder = nil;
  bool ours = false;
};

void logKeyLine(const KeyContext& key, const std::string& route) {
  if (!g_logKeys.load()) return;
  NSEvent* event = key.event;
  const bool down = event.type == NSEventTypeKeyDown;
  std::string line = std::string("panel key: ") + (down ? "down" : "up") + " keyCode=" + std::to_string(event.keyCode);
  if (key.ours)
    line += " chars=" + escapedChars(event.characters) + " base=" + escapedChars(event.charactersIgnoringModifiers);
  line += " mods=" + modifierText(event.modifierFlags) + " panelWindow=" + yesNo(windowHostsAWebView(key.window)) +
          " keyWindowIsIt=" + yesNo(NSApp.keyWindow == key.window) +
          " canBecomeKey=" + yesNo(key.window.canBecomeKeyWindow) + " eventWindow=" + className(key.window) +
          " firstResponder=" + className(key.responder) + " route=" + route;
  logLine(line);
}

void logNotOurs(const KeyContext& key) {
  if (key.event.type != NSEventTypeKeyDown) return;
  logKeyLine(key, std::string("not-ours(") +
                      (windowHostsAWebView(key.window) ? "first responder is outside the web view"
                                                       : "window is not a panel window") +
                      ")");
}

NSEvent* deliverKey(const KeyContext& key, extyntWebView* web, Route route, const KeyAction& act) {
  const bool down = key.event.type == NSEventTypeKeyDown;
  if (route == Route::Action) {
    if (!down) {
      logKeyLine(key, "monitor-swallowed-keyup");
      return nil;
    }
    logKeyLine(key, performAction(web, key.responder, act));
    return nil;
  }
  logKeyLine(key, "monitor-keydown");
  rememberRouted(key.event);
  if (down) [key.responder keyDown:key.event];
  else [key.responder keyUp:key.event];
  return nil;
}

NSEvent* handleKey(NSEvent* event) {
  KeyContext key;
  key.event = event;
  key.window = event.window;
  key.responder = key.window.firstResponder;
  extyntWebView* web = webViewContaining(key.responder);
  if (isResend(event)) {
    key.ours = web != nil;
    logKeyLine(key, "monitor-swallowed-resend");
    return nil;
  }
  if (!web) {
    logNotOurs(key);
    return event;
  }
  key.ours = true;
  KeyAction act;
  const Route route = classify(event, &act);
  if (route == Route::Pass) {
    logKeyLine(key, "passed-to-AE");
    return event;
  }
  return deliverKey(key, web, route, act);
}

struct Hit {
  extyntWebView* web = nil;
  NSView* view = nil;
};

Hit findHit(NSWindow* window, NSEvent* event) {
  for (extyntWebView* web in liveViews().allObjects) {
    if (web.window != window || !web.superview) continue;
    NSView* candidate = [web hitTest:[web.superview convertPoint:event.locationInWindow fromView:nil]];
    if (candidate && (candidate == web || [candidate isDescendantOf:web])) return {web, candidate};
  }
  return {};
}

bool mouseIsLoggable(NSWindow* window, extyntWebView* target) {
  return g_logKeys.load() && (target != nil || (windowHostsAWebView(window) && window != NSApp.mainWindow));
}

std::string mouseLine(NSWindow* window, const Hit& hit) {
  return "panel mouse: down " + windowText(window) + " hit=" + className(hit.view) + " ours=" + yesNo(hit.web != nil) +
         " firstResponder=" + className(window.firstResponder);
}

void handFocusBack(NSWindow* window) {
  if (!webViewContaining(window.firstResponder)) return;
  NSResponder* previous = g_previousResponder;
  const bool restorable = previous && [previous isKindOfClass:[NSView class]] &&
                          static_cast<NSView*>(previous).window == window && !webViewContaining(previous);
  const BOOL done = [window makeFirstResponder:restorable ? previous : nil];
  logLine("panel mouse: click outside the web view, focus handed back to " +
          (restorable ? className(previous) : std::string("the window")) + " ok=" + yesNo(done));
}

std::string focusWebView(NSWindow* window, extyntWebView* target) {
  std::string did;
  if (!window.keyWindow && window.canBecomeKeyWindow) {
    [window makeKeyWindow];
    did += " makeKeyWindow";
  } else if (!window.keyWindow) {
    did += " window cannot become key";
  }
  if (![target firstResponderIsInside]) {
    g_previousResponder = window.firstResponder;
    did += std::string(" makeFirstResponder(web)=") + yesNo([window makeFirstResponder:target]);
  }
  return did;
}

std::string routeMouseDown(NSWindow* window, extyntWebView* target) {
  if (!target) {
    handFocusBack(window);
    return "";
  }
  const std::string did = focusWebView(window, target);
  return " did:" + (did.empty() ? " nothing (already key, web view already first responder)" : did);
}

NSEvent* handleMouseDown(NSEvent* event) {
  NSWindow* window = event.window;
  if (!window || liveViews().count == 0) return event;
  const Hit hit = findHit(window, event);
  const bool loggable = mouseIsLoggable(window, hit.web);
  const std::string line = loggable ? mouseLine(window, hit) : std::string();
  const std::string tail = routeMouseDown(window, hit.web);
  if (loggable) logLine(line + tail);
  return event;
}

NSEvent* handleEvent(NSEvent* event) {
  if (liveViews().count == 0) return event;
  @try {
    if (event.type == NSEventTypeLeftMouseDown) return handleMouseDown(event);
    if (event.type == NSEventTypeKeyDown || event.type == NSEventTypeKeyUp) return handleKey(event);
  } @catch (NSException* exception) {
    logLine(std::string("panel: event monitor threw: ") + stdString(exception.reason) + "; the event is passed on");
  }
  return event;
}

NSEvent* handleEventNoThrow(NSEvent* event) {
  try {
    return handleEvent(event);
  } catch (...) {
    logDroppedException("event monitor");
    return event;
  }
}

}

void installMonitor() {
  if (g_monitor) return;
  g_monitor =
      [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskLeftMouseDown)
                                            handler:^NSEvent*(NSEvent* event) { return handleEventNoThrow(event); }];
  logLine(g_monitor ? "panel: event monitor installed (keys and left mouse down)"
                    : "panel: event monitor could not be installed");
}

void removeMonitor() {
  if (!g_monitor) return;
  [NSEvent removeMonitor:g_monitor];
  g_monitor = nil;
}

}

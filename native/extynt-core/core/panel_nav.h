// What the panel's web view may navigate to. Pure core: the Objective-C++ delegate turns an NSURL into text, asks here,
// and acts on the answer.
#pragma once

#include <cstdint>
#include <string>

namespace extynt::ae {

// What the web view does with a navigation: load it, hand it to the default browser, or drop it.
enum class NavigationAction : std::uint8_t { Allow, OpenExternal, Cancel };

// What the page is allowed to load. `origin` is "scheme://host:port" of the document the panel loaded. Normally only
// "<origin>/ui/..." is allowed; a development override (panel-url.txt) allows every path of its origin.
struct NavigationScope {
  std::string origin;
  bool anyPath = false;
};

// A navigation the web view asks about: the target URL, and whether the user clicked a link to get there
// (WKNavigationTypeLinkActivated).
struct NavigationRequest {
  std::string url;
  bool linkActivated = false;
};

// about:blank and the scope are allowed. Any other http or https URL that the user clicked opens in the browser; every
// other navigation (a script redirect, another scheme, a malformed URL) is cancelled.
NavigationAction decideNavigation(const NavigationScope& scope, const NavigationRequest& request);

// "scheme://host:port" of an absolute URL, lower case ("file://" for a file URL); empty when `url` has no authority
// (about:blank, mailto:) or is not a URL. This is the NavigationScope::origin of a page the panel loaded.
std::string originOfUrl(const std::string& url);

// True when the panel-url.txt development override may load `url`: only in a development-library build (a release
// plugin never reads the file, or a planted one could replace the UI) and only an http or https URL (never file://).
bool developmentOverrideAllowed(bool developmentBuild, const std::string& url);

// True when a failed navigation means the sidecar is not there (so the offline page is shown and the load is retried):
// a connection failure (NSURLErrorDomain) or a refused or restricted port (WebKitErrorDomain). A cancelled load
// (NSURLErrorCancelled, which also follows a policy-cancelled link) and WebKit's "frame load interrupted" (102, a
// policy change or a newer load replacing this one) are not failures.
bool failureShowsOfflinePage(const std::string& errorDomain, long errorCode);

// The Windows counterpart of failureShowsOfflinePage: `status` is a COREWEBVIEW2_WEB_ERROR_STATUS from WebView2's
// NavigationCompleted (an unreachable server, a timeout, an invalid response, a dropped or refused connection, a name
// that does not resolve, an unexpected error). Cancelled and redirect failures, authentication and certificate
// problems are not "the sidecar is not there".
bool webErrorShowsOfflinePage(int status);

// True when a navigation WebKit reports as finished left the view on `finishedUrl` with no page: WebKit on macOS 15
// refuses a restricted port (6000, 1, ...) by committing about:blank instead of failing with WebKitErrorDomain 103, so
// the panel would stay white. The offline page itself is also about:blank, so it never counts (`offlinePageShowing`).
bool finishedBlankShowsOfflinePage(const std::string& finishedUrl, bool offlinePageShowing);

// How long a sidecar page load may run without finishing or failing before the offline page replaces it.
constexpr int kLoadWatchdogSeconds = 5;

// The watchdog timer of the load numbered `ticket` fired. True when that load is still the latest one and neither
// finished nor failed, so the panel would otherwise stay blank.
bool loadWatchdogShowsOffline(std::uint64_t ticket, std::uint64_t latestTicket, bool settled);

// True when the loaded page is the sidecar UI ("http://127.0.0.1:<port>") on a port other than `sessionPort`, the port
// session.json names now: the sidecar restarted on a new port and the page is stranded. Any other page (a development
// override, the built-in test page, none) is never stale.
bool pageOriginIsStale(const std::string& pageOrigin, int sessionPort);

}

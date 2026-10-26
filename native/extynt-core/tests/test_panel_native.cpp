// Tests for the native panel's pure decisions: page loading, origins, focus routing and menus.
#include <cstddef>
#include <optional>
#include <string>

#include "panel_nav.h"
#include "panel_page.h"
#include "panel_theme.h"
#include "session_port.h"
#include "testing.h"

using namespace extynt;
using namespace extynt::ae;

namespace {

bool has(const std::string& text, const std::string& part) { return text.find(part) != std::string::npos; }

TEST(session_endpoint_has_the_port_and_the_token) {
  const std::optional<SessionEndpoint> endpoint = sessionEndpointFromJson(R"({"port":56284,"token":"abc_DEF-123"})");
  CHECK(endpoint.has_value());
  CHECK_EQ(testing::need(endpoint, "endpoint").port, 56284);
  CHECK_EQ(testing::need(endpoint, "endpoint").token, std::string("abc_DEF-123"));
  CHECK_EQ(testing::need(sessionEndpointFromJson(R"({"token":"t","port":3210,"extra":1})"), "endpoint").port, 3210);
}

TEST(session_endpoint_refuses_anything_without_a_usable_port_and_token) {
  for (const char* bad :
       {"", "not json", "[]", "{}", R"({"port":3210})", R"({"token":"x"})", R"({"port":"3210","token":"x"})",
        R"({"port":0,"token":"x"})", R"({"port":65536,"token":"x"})", R"({"port":12.5,"token":"x"})",
        R"({"port":-1,"token":"x"})", R"({"port":3210,"token":""})", R"({"port":3210,"token":7})",
        R"({"port":3210,"token":null})"}) {
    CHECK(!sessionEndpointFromJson(bad).has_value());
  }
  const std::string longToken(kMaxSessionTokenLength + 1, 'a');
  CHECK(!sessionEndpointFromJson("{\"port\":1,\"token\":\"" + longToken + "\"}").has_value());
  const std::string fullToken(kMaxSessionTokenLength, 'a');
  CHECK(sessionEndpointFromJson("{\"port\":1,\"token\":\"" + fullToken + "\"}").has_value());
}

TEST(js_string_literal_escapes_quotes_backslashes_and_controls) {
  CHECK_EQ(jsStringLiteral("plain"), std::string("\"plain\""));
  CHECK_EQ(jsStringLiteral("a\"b"), std::string("\"a\\\"b\""));
  CHECK_EQ(jsStringLiteral("a\\b"), std::string("\"a\\\\b\""));
  CHECK_EQ(jsStringLiteral("a\\\"b"), std::string("\"a\\\\\\\"b\""));
  CHECK_EQ(jsStringLiteral("l1\nl2\r\t"), std::string("\"l1\\nl2\\r\\t\""));
  CHECK_EQ(jsStringLiteral(std::string("a\0b", 3)), std::string("\"a\\u0000b\""));
  CHECK_EQ(jsStringLiteral("\x01\x1f"), std::string("\"\\u0001\\u001f\""));
}

TEST(js_string_literal_cannot_close_a_script_element_or_a_line) {
  const std::string script = jsStringLiteral("</script><!--");
  CHECK(!has(script, "<"));
  CHECK_EQ(script, std::string("\"\\u003C/script>\\u003C!--\""));
  const std::string separators = jsStringLiteral(
      "a\xE2\x80\xA8"
      "b\xE2\x80\xA9"
      "c");
  CHECK_EQ(separators, std::string("\"a\\u2028b\\u2029c\""));
  CHECK(!has(separators, "\xE2\x80\xA8"));
  CHECK(!has(separators, "\xE2\x80\xA9"));
}

TEST(js_string_literal_keeps_text_and_repairs_malformed_utf8) {
  CHECK_EQ(jsStringLiteral("caf\xC3\xA9 \xE2\x80\xA6"), std::string("\"caf\xC3\xA9 \xE2\x80\xA6\""));
  CHECK_EQ(jsStringLiteral("\xE2\x80"), std::string("\"\xEF\xBF\xBD\xEF\xBF\xBD\""));
  CHECK_EQ(jsStringLiteral("\xFF"), std::string("\"\xEF\xBF\xBD\""));
}

HostTheme theme(const std::string& background, double luminance) {
  HostTheme out;
  out.background = background;
  out.luminance = luminance;
  return out;
}

struct InfoFields {
  std::string version;
  std::string aeVersion;
  std::string origin;
  std::string token;
  std::optional<HostTheme> theme;
};

NativeInfo infoOf(const InfoFields& fields) {
  NativeInfo info;
  info.pluginVersion = fields.version;
  info.aeVersion = fields.aeVersion;
  info.origin = fields.origin;
  info.token = fields.token;
  info.platform = "macos";
  info.theme = fields.theme;
  return info;
}

TEST(native_info_script_defines_the_frozen_object_only_on_the_sidecar_origin) {
  const std::string script = panelNativeInfoScript(
      infoOf({"0.9.4", "26.5.0 (build 61)", "http://127.0.0.1:56284", "tok_en-1", theme("#232323", 0.137)}));
  CHECK_EQ(script,
           std::string("if (location.origin === \"http://127.0.0.1:56284\") window.__extyntNative = "
                       "Object.freeze({pluginVersion: \"0.9.4\", aeVersion: \"26.5.0 (build 61)\", sidecarOrigin: "
                       "\"http://127.0.0.1:56284\", token: \"tok_en-1\", platform: \"macos\", theme: "
                       "{background: \"#232323\", luminance: 0.137}});"));
}

TEST(native_info_script_names_the_platform_it_runs_on) {
  NativeInfo info = infoOf({"1", "2", "http://127.0.0.1:9", "t", std::nullopt});
  info.platform = "windows";
  CHECK(has(panelNativeInfoScript(info), "platform: \"windows\""));
}

TEST(native_info_script_uses_null_for_a_missing_ae_version_or_theme) {
  const std::string script = panelNativeInfoScript(infoOf({"1", "", "http://127.0.0.1:9", "t", std::nullopt}));
  CHECK(has(script, "aeVersion: null"));
  CHECK(has(script, "theme: null"));
  HostTheme broken = theme("#000000", 0);
  broken.luminance = 1.0 / 0.0;
  CHECK(has(panelNativeInfoScript(infoOf({"1", "2", "http://127.0.0.1:9", "t", broken})), "theme: null"));
}

TEST(native_info_script_escapes_every_string_it_carries) {
  const std::string hostile = "a\"b\\c</script>\n\xE2\x80\xA8";
  const std::string script = panelNativeInfoScript(infoOf({hostile, hostile, hostile, hostile, theme(hostile, 0.5)}));
  CHECK(!has(script, "<"));
  CHECK(!has(script, "\n"));
  CHECK(!has(script, "\xE2\x80\xA8"));
  std::size_t escaped = 0;
  for (std::size_t at = script.find(R"(a\"b\\c\u003C/script>\n\u2028)"); at != std::string::npos;
       at = script.find(R"(a\"b\\c\u003C/script>\n\u2028)", at + 1))
    ++escaped;
  CHECK_EQ(escaped, static_cast<std::size_t>(6));
}

TEST(document_end_wrapper_runs_the_source_once_the_document_is_parsed) {
  const std::string wrapped = runAtDocumentEnd("window.x = 1;");
  CHECK(has(wrapped, "window.x = 1;"));
  CHECK(has(wrapped, "document.readyState === \"loading\""));
  CHECK(has(wrapped, "DOMContentLoaded"));
  CHECK(has(wrapped, "{once: true}"));
}

TEST(theme_event_script_dispatches_the_detail_the_page_reads) {
  CHECK_EQ(panelThemeEventScript(theme("#ededed", 0.929)),
           std::string("window.dispatchEvent(new CustomEvent(\"extynt-theme\", {detail: {background: \"#ededed\", "
                       "luminance: 0.929}}));"));
}

TEST(offline_page_says_starting_and_loads_nothing_from_outside) {
  const std::string page = panelOfflinePageHtml();
  CHECK(has(page, "Starting extynt&hellip;"));
  CHECK(has(page, "prefers-color-scheme: light"));
  CHECK(has(page, "#16171b"));
  CHECK(has(page, "#f5f6f8"));
  for (const char* forbidden : {"<script", "http://", "https://", "src=", "url(", "@import", "<link", "<img"})
    CHECK(!has(page, forbidden));
}

TEST(offline_page_takes_the_host_theme_over_the_system_scheme) {
  const std::string dark = panelOfflinePageHtml(theme("#1d1d1d", 0.114));
  CHECK(has(dark, ":root { color-scheme: dark; --bg: #1d1d1d; --text: #e9eaef;"));
  CHECK(dark.find("--bg: #1d1d1d") > dark.find("prefers-color-scheme: light"));
  const std::string light = panelOfflinePageHtml(theme("#ededed", 0.929));
  CHECK(has(light, ":root { color-scheme: light; --bg: #ededed; --text: #181a1f;"));
  CHECK_EQ(panelOfflinePageHtml(theme("red;}", 0.1)), panelOfflinePageHtml());
}

TEST(theme_from_a_16_bit_app_colour) {
  const HostTheme black = hostThemeFromAppColor(0, 0, 0);
  CHECK_EQ(black.background, std::string("#000000"));
  CHECK_EQ(black.luminance, 0.0);
  const HostTheme white = hostThemeFromAppColor(65535, 65535, 65535);
  CHECK_EQ(white.background, std::string("#ffffff"));
  CHECK_EQ(white.luminance, 1.0);
  const HostTheme grey = hostThemeFromAppColor(0x2323, 0x2323, 0x2323);
  CHECK_EQ(grey.background, std::string("#232323"));
  CHECK_EQ(grey.luminance, 0.137);
  CHECK_EQ(hostThemeFromAppColor(65535, 0, 0).background, std::string("#ff0000"));
  CHECK_EQ(hostThemeFromAppColor(65535, 0, 0).luminance, 0.213);
  CHECK_EQ(hostThemeFromAppColor(0, 65535, 0).luminance, 0.715);
  CHECK_EQ(hostThemeFromAppColor(0, 0, 65535).luminance, 0.072);
}

TEST(theme_from_an_8_bit_app_colour_and_out_of_range_values) {
  CHECK_EQ(hostThemeFromAppColor(35, 35, 35).background, std::string("#232323"));
  CHECK_EQ(hostThemeFromAppColor(255, 255, 255).luminance, 1.0);
  CHECK_EQ(hostThemeFromAppColor(0, 0, 0).background, std::string("#000000"));
  CHECK_EQ(hostThemeFromAppColor(70000, 70000, 70000).background, std::string("#ffffff"));
  const HostTheme mid = hostThemeFromAppColor(32896, 32896, 32896);
  CHECK_EQ(mid.background, std::string("#808080"));
  CHECK(mid.luminance > 0.49 && mid.luminance < 0.51);
}

NavigationScope sidecar() {
  NavigationScope scope;
  scope.origin = "http://127.0.0.1:56284";
  return scope;
}

NavigationAction decide(const NavigationScope& scope, const std::string& url, bool link = false) {
  NavigationRequest request;
  request.url = url;
  request.linkActivated = link;
  return decideNavigation(scope, request);
}

TEST(navigation_allows_the_sidecar_ui_and_about_blank) {
  const NavigationScope scope = sidecar();
  for (const char* url : {"http://127.0.0.1:56284/ui/", "http://127.0.0.1:56284/ui/index.html",
                          "http://127.0.0.1:56284/ui/?x=1#y", "HTTP://127.0.0.1:56284/ui/styles/tokens.css",
                          "http://127.0.0.1:56284/ui/a/b.js?v=2", "about:blank", "ABOUT:BLANK"}) {
    CHECK(decide(scope, url) == NavigationAction::Allow);
    CHECK(decide(scope, url, true) == NavigationAction::Allow);
  }
}

TEST(navigation_sends_a_clicked_web_link_elsewhere_to_the_browser) {
  const NavigationScope scope = sidecar();
  for (const char* url :
       {"https://example.com/", "http://example.com/ui/", "http://127.0.0.1:56285/ui/",
        "http://127.0.0.1:56284/v1/ui/bootstrap", "http://127.0.0.1:56284/", "http://127.0.0.1:56284",
        "http://127.0.0.1:56284/ui", "http://127.0.0.1:56284/ui/../v1/x", "http://127.0.0.1:56284/ui/%2e%2e/v1",
        "http://127.0.0.1:56284/ui/..%2fv1", "http://127.0.0.1:56284/ui\\..\\v1",
        "http://127.0.0.1:56284@evil.example/ui/", "http://127.0.0.1:56284:81/ui/", "https://127.0.0.1:56284/ui/"}) {
    CHECK(decide(scope, url, true) == NavigationAction::OpenExternal);
    CHECK(decide(scope, url, false) == NavigationAction::Cancel);
  }
}

TEST(navigation_cancels_everything_else) {
  const NavigationScope scope = sidecar();
  for (const char* url :
       {"", "not a url", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c",
        "ftp://example.com/", "about:srcdoc", "x:", ":", "1http://a/", "http//example.com"}) {
    CHECK(decide(scope, url, true) == NavigationAction::Cancel);
    CHECK(decide(scope, url, false) == NavigationAction::Cancel);
  }
  CHECK(decide(NavigationScope{}, "http://127.0.0.1:56284/ui/") == NavigationAction::Cancel);
}

TEST(a_development_override_allows_every_path_of_its_origin_only) {
  NavigationScope scope;
  scope.origin = "http://localhost:5173";
  scope.anyPath = true;
  CHECK(decide(scope, "http://localhost:5173/") == NavigationAction::Allow);
  CHECK(decide(scope, "http://LOCALHOST:5173/app/x?y#z") == NavigationAction::Allow);
  CHECK(decide(scope, "http://localhost:5173") == NavigationAction::Allow);
  CHECK(decide(scope, "http://localhost:5174/", true) == NavigationAction::OpenExternal);
  scope.origin = "file://";
  CHECK(decide(scope, "file:///tmp/page.html") == NavigationAction::Allow);
  CHECK(decide(scope, "https://example.com/", true) == NavigationAction::OpenExternal);
}

TEST(the_development_override_is_for_development_builds_and_web_urls_only) {
  CHECK(developmentOverrideAllowed(true, "http://localhost:5173/"));
  CHECK(developmentOverrideAllowed(true, "HTTPS://example.com/ui/"));
  CHECK(!developmentOverrideAllowed(false, "http://localhost:5173/"));
  for (const char* url :
       {"file:///tmp/x.html", "FILE:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "", "x"})
    CHECK(!developmentOverrideAllowed(true, url));
}

TEST(the_origin_of_a_url_is_its_scheme_and_authority) {
  CHECK_EQ(originOfUrl("http://127.0.0.1:56284/ui/"), std::string("http://127.0.0.1:56284"));
  CHECK_EQ(originOfUrl("HTTP://LocalHost:5173?x=1"), std::string("http://localhost:5173"));
  CHECK_EQ(originOfUrl("http://127.0.0.1/"), std::string("http://127.0.0.1"));
  CHECK_EQ(originOfUrl("file:///tmp/a.html"), std::string("file://"));
  for (const char* none : {"", "about:blank", "mailto:a@b.c", "no scheme", "/ui/"})
    CHECK_EQ(originOfUrl(none), std::string());
}

TEST(only_a_real_connection_failure_shows_the_offline_page) {
  CHECK(failureShowsOfflinePage("NSURLErrorDomain", -1004));
  CHECK(failureShowsOfflinePage("NSURLErrorDomain", -1001));
  CHECK(failureShowsOfflinePage("NSURLErrorDomain", -1009));
  CHECK(!failureShowsOfflinePage("NSURLErrorDomain", -999));
  CHECK(!failureShowsOfflinePage("WebKitErrorDomain", 102));
  CHECK(!failureShowsOfflinePage("", 0));
}

TEST(a_refused_or_restricted_port_shows_the_offline_page) {
  CHECK(failureShowsOfflinePage("WebKitErrorDomain", 103));
  CHECK(failureShowsOfflinePage("WebKitErrorDomain", 101));
  CHECK(!failureShowsOfflinePage("WebKitErrorDomain", 102));
  CHECK(!failureShowsOfflinePage("SomeOtherDomain", -1004));
  CHECK(!failureShowsOfflinePage("NSPOSIXErrorDomain", 61));
}

TEST(a_load_that_finishes_blank_shows_the_offline_page) {
  CHECK(finishedBlankShowsOfflinePage("about:blank", false));
  CHECK(finishedBlankShowsOfflinePage("", false));
  CHECK(!finishedBlankShowsOfflinePage("about:blank", true));
  CHECK(!finishedBlankShowsOfflinePage("http://127.0.0.1:54321/ui/", false));
  CHECK(!finishedBlankShowsOfflinePage("http://127.0.0.1/", false));
}

TEST(the_load_watchdog_fires_only_for_the_latest_load_that_has_not_settled) {
  CHECK(kLoadWatchdogSeconds > 0);
  CHECK(loadWatchdogShowsOffline(3, 3, false));
  CHECK(!loadWatchdogShowsOffline(3, 3, true));
  CHECK(!loadWatchdogShowsOffline(2, 3, false));
  CHECK(!loadWatchdogShowsOffline(2, 3, true));
}

TEST(a_page_on_another_sidecar_port_is_stale) {
  CHECK(pageOriginIsStale("http://127.0.0.1:54321", 61000));
  CHECK(!pageOriginIsStale("http://127.0.0.1:54321", 54321));
  CHECK(pageOriginIsStale("http://127.0.0.1:3210", 3211));
}

TEST(only_a_sidecar_page_can_be_stale) {
  CHECK(!pageOriginIsStale("", 3210));
  CHECK(!pageOriginIsStale("http://127.0.0.1:", 3210));
  CHECK(!pageOriginIsStale("http://127.0.0.1:99999", 3210));
  CHECK(!pageOriginIsStale("http://127.0.0.1:12ab", 3210));
  CHECK(!pageOriginIsStale("http://localhost:5173", 3210));
  CHECK(!pageOriginIsStale("https://127.0.0.1:5173", 3210));
  CHECK(!pageOriginIsStale("http://127.0.0.1", 3210));
}

}

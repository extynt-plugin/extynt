// The WebView2 environment options, a COM object: the browser arguments, a language and a conservative compatible
// browser version floor, so any current Evergreen install qualifies.
#include "ae_panel_win_options.h"

#include <windows.h>

#include <string>
#include <utility>

#include "sdk_win_com.h"

namespace extynt::ae::panel {

namespace {

const wchar_t* const kCompatibleBrowserVersion = L"110.0.1587.0";

class EnvironmentOptions final : public ComObject<ICoreWebView2EnvironmentOptions> {
  struct Key {};

 public:
  EnvironmentOptions([[maybe_unused]] Key key, std::wstring arguments) : arguments_(std::move(arguments)) {}

  static ComRef<ICoreWebView2EnvironmentOptions> make(std::wstring arguments) {
    return create<EnvironmentOptions>(Key{}, std::move(arguments));
  }

  HRESULT STDMETHODCALLTYPE get_AdditionalBrowserArguments(LPWSTR* value) override {
    return copyToCoTaskString(arguments_, value);
  }
  HRESULT STDMETHODCALLTYPE put_AdditionalBrowserArguments(LPCWSTR value) override {
    arguments_ = value != nullptr ? value : L"";
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_Language(LPWSTR* value) override { return copyToCoTaskString(language_, value); }
  HRESULT STDMETHODCALLTYPE put_Language(LPCWSTR value) override {
    language_ = value != nullptr ? value : L"";
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_TargetCompatibleBrowserVersion(LPWSTR* value) override {
    return copyToCoTaskString(kCompatibleBrowserVersion, value);
  }
  HRESULT STDMETHODCALLTYPE put_TargetCompatibleBrowserVersion([[maybe_unused]] LPCWSTR version) override {
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE get_AllowSingleSignOnUsingOSPrimaryAccount(BOOL* allow) override {
    if (allow == nullptr) return E_POINTER;
    *allow = FALSE;
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE put_AllowSingleSignOnUsingOSPrimaryAccount([[maybe_unused]] BOOL allow) override {
    return S_OK;
  }

 private:
  std::wstring arguments_;
  std::wstring language_;
};

}

ComRef<ICoreWebView2EnvironmentOptions> makeEnvironmentOptions(const std::wstring& arguments) {
  return EnvironmentOptions::make(arguments);
}

}

// Windows COM plumbing for the WebView2 panel: a reference-counting pointer, a base for the COM objects we implement,
// and a callback object that runs a std::function. The untyped pointers COM forces (QueryInterface, CoTaskMemAlloc)
// exist only here. objbase.h is included for the `interface` macro WebView2.h is written with, which
// WIN32_LEAN_AND_MEAN leaves out.
#pragma once

#include <windows.h>
#include <objbase.h>

#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <utility>

#include "WebView2.h"
#include "ae_log.h"

namespace extynt::ae::panel {

// RPC_E_CHANGED_MODE spelled as a typed constant: the SDK macro carries a lowercase literal suffix.
inline constexpr HRESULT kApartmentChanged = static_cast<HRESULT>(0x80010106U);

// HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND), which is what the WebView2 loader reports when the runtime is missing.
inline constexpr HRESULT kFileNotFoundResult = static_cast<HRESULT>(0x80070002U);

// A CoTaskMemAlloc copy of `text`, as the string getters of COM interfaces must return it.
HRESULT copyToCoTaskString(const std::wstring& text, LPWSTR* out);

// Owns one reference to a COM object; copies add references, destruction releases.
template <typename T>
class ComRef {
 public:
  ComRef() = default;
  explicit ComRef(T* raw) : pointer_(raw) {
    if (pointer_ != nullptr) pointer_->AddRef();
  }
  ComRef(const ComRef& other) : ComRef(other.pointer_) {}
  ComRef(ComRef&& other) noexcept : pointer_(std::exchange(other.pointer_, nullptr)) {}
  ComRef& operator=(const ComRef& other) {
    ComRef copy(other);
    std::swap(pointer_, copy.pointer_);
    return *this;
  }
  ComRef& operator=(ComRef&& other) noexcept {
    std::swap(pointer_, other.pointer_);
    return *this;
  }
  ~ComRef() { reset(); }

  static ComRef adopt(T* owned) {
    ComRef out;
    out.pointer_ = owned;
    return out;
  }

  [[nodiscard]] T* get() const { return pointer_; }
  T* operator->() const { return pointer_; }
  explicit operator bool() const { return pointer_ != nullptr; }

  void reset() {
    if (pointer_ != nullptr) pointer_->Release();
    pointer_ = nullptr;
  }

  T** put() {
    reset();
    return &pointer_;
  }

  template <typename U>
  [[nodiscard]] ComRef<U> as() const {
    U* other = nullptr;
    if (pointer_ != nullptr) pointer_->QueryInterface(__uuidof(U), reinterpret_cast<LPVOID*>(&other));
    return ComRef<U>::adopt(other);
  }

 private:
  T* pointer_ = nullptr;
};

// Base of a COM object implemented here: IUnknown over a reference count that starts at one (the creator's). The
// object keeps itself alive in a shared_ptr that the last Release drops, so no raw new or delete exists.
template <typename Interface>
class ComObject : public Interface {
 public:
  template <typename Derived, typename... Arguments>
  static ComRef<Interface> create(Arguments&&... arguments) {
    std::shared_ptr<Derived> object = std::make_shared<Derived>(std::forward<Arguments>(arguments)...);
    object->self_ = object;
    return ComRef<Interface>::adopt(object.get());
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, LPVOID* out) override {
    if (out == nullptr) return E_POINTER;
    if (IsEqualIID(id, IID_IUnknown) || IsEqualIID(id, __uuidof(Interface))) {
      *out = static_cast<Interface*>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG remaining{--references_};
    if (remaining == 0) {
      const std::shared_ptr<ComObject> last = std::move(self_);
      return 0;
    }
    return remaining;
  }

 protected:
  ComObject() = default;

 private:
  std::atomic<ULONG> references_{1};
  std::shared_ptr<ComObject> self_;
};

// A WebView2 handler interface whose Invoke takes `Args` and runs a function. A C++ exception from the function is
// logged and becomes E_FAIL: nothing propagates into the WebView2 runtime.
template <typename Handler, typename... Args>
class ComCallback final : public ComObject<Handler> {
  struct Key {};

 public:
  using Function = std::function<HRESULT(Args...)>;

  ComCallback([[maybe_unused]] Key key, Function function) : function_(std::move(function)) {}

  static ComRef<Handler> make(Function function) {
    return ComObject<Handler>::template create<ComCallback>(Key{}, std::move(function));
  }

  HRESULT STDMETHODCALLTYPE Invoke(Args... args) override {
    try {
      return function_(args...);
    } catch (...) {
      logDroppedException("webview2 callback");
      return E_FAIL;
    }
  }

 private:
  Function function_;
};

}

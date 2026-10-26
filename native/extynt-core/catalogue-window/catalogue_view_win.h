// Windows only: draws the catalogue page the way CatalogueView.m does on the Mac: an ink band with the state,
// extynt.com's ruled progress bar, a receipt with one row per After Effects version and a note, in the site's
// ink-on-paper colours (light and dark). Every measure below is in device-independent pixels (96 dpi); the caller
// scales for the monitor. The words come from catalogue_status.h (Page); this file only draws them. footnote is the
// footer's line left of the Done button.
#pragma once

#include <memory>
#include <string>

#include "catalogue_status.h"

namespace Gdiplus {
class Bitmap;
}

namespace extynt::catalogue {

class CatalogueView {
 public:
  static constexpr float kWidth = 418;
  static constexpr float kPageHeight = 330;
  static constexpr float kFooter = 52;

  // What changed on the screen since the last step, so the window repaints only that.
  enum Dirty : unsigned { kNothing = 0, kBar = 1, kSpinner = 2 };

  CatalogueView();
  ~CatalogueView();
  CatalogueView(const CatalogueView&) = delete;
  CatalogueView& operator=(const CatalogueView&) = delete;

  Page page;
  std::wstring footnote;

  void setDark(bool dark);
  // Hands the page's bar to the animation: call after anything that changed page.bar.
  void syncBar();
  // Advances the bar's tween and the spinner to `now` (seconds on any steady clock).
  unsigned step(double now);
  // The whole window content (with the footer) or the page alone, at `scale` device pixels per DIP. Needs GDI+ started.
  std::unique_ptr<Gdiplus::Bitmap> render(float scale, double now, bool withFooter);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}

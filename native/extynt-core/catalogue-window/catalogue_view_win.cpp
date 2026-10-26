// Draws the catalogue page for catalogue_view_win.h with GDI+: the band, the ruled progress bar that eases to each new
// value (or slides while the total is unknown), the receipt card and the note, in the site's ink-on-paper tokens where
// dark mode swaps paper and ink, with the measures of CatalogueView.m. Fonts are the first installed family of a list
// (IBM Plex where it is, the system's faces otherwise). The GDI+ headers use the unqualified min and max that NOMINMAX
// removes, so they are brought in before the include.
#include "catalogue_view_win.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <initializer_list>
#include <vector>

#include <windows.h>
#include <objidl.h>

#include <gdiplus.h>

#include "windows_paths.h"

namespace extynt::catalogue {

namespace {

using Gdiplus::Color;
using Gdiplus::REAL;

constexpr REAL kPad = 20, kBandHeight = 74, kHeadHeight = 24, kRowHeight = 38, kTagWidth = 92, kDrop = 4;
constexpr REAL kBarTween = 0.6F;

Color ink(unsigned hex) {
  return {255, static_cast<BYTE>((hex >> 16) & 0xff), static_cast<BYTE>((hex >> 8) & 0xff),
          static_cast<BYTE>(hex & 0xff)};
}

struct Palette {
  Color paper, text, band, onBand, onBandMuted, muted, faint, line, drop, green, amber, amberSoft;
};

Palette palette(bool dark) {
  if (dark) {
    return Palette{ink(0x1b1b1a), ink(0xf4f2ec), ink(0xf4f2ec), ink(0x151515), ink(0x55534d), ink(0xc9c5bb),
                   ink(0xa9a59b), ink(0x3a3834), ink(0x4a4741), ink(0x6fbf8a), ink(0xe2ad55), ink(0x2c2518)};
  }
  return Palette{ink(0xfbfaf7), ink(0x151515), ink(0x151515), ink(0xf4f2ec), ink(0xa9a59b), ink(0x55534d),
                 ink(0x6a675f), ink(0xd9d5ca), ink(0x151515), ink(0x1d6a3c), ink(0x855300), ink(0xf3e7cf)};
}

struct Candidate {
  const wchar_t* family;
  INT style;
};

std::unique_ptr<Gdiplus::Font> makeFont(std::initializer_list<Candidate> candidates, REAL size) {
  for (const Candidate& candidate : candidates) {
    Gdiplus::FontFamily family(candidate.family);
    if (family.IsAvailable() != FALSE)
      return std::make_unique<Gdiplus::Font>(&family, size, candidate.style, Gdiplus::UnitPixel);
  }
  return std::make_unique<Gdiplus::Font>(L"Segoe UI", size, Gdiplus::FontStyleRegular, Gdiplus::UnitPixel);
}

struct Fonts {
  std::unique_ptr<Gdiplus::Font> eyebrow = makeFont({{L"IBM Plex Mono Medium", Gdiplus::FontStyleRegular},
                                                     {L"Cascadia Mono", Gdiplus::FontStyleRegular},
                                                     {L"Consolas", Gdiplus::FontStyleRegular}},
                                                    9.5F);
  std::unique_ptr<Gdiplus::Font> heading = makeFont(
      {{L"IBM Plex Sans SemiBold", Gdiplus::FontStyleRegular}, {L"Segoe UI Semibold", Gdiplus::FontStyleRegular}},
      16.0F);
  std::unique_ptr<Gdiplus::Font> detail =
      makeFont({{L"IBM Plex Sans", Gdiplus::FontStyleRegular}, {L"Segoe UI", Gdiplus::FontStyleRegular}}, 11.5F);
  std::unique_ptr<Gdiplus::Font> note =
      makeFont({{L"IBM Plex Sans", Gdiplus::FontStyleRegular}, {L"Segoe UI", Gdiplus::FontStyleRegular}}, 11.0F);
  std::unique_ptr<Gdiplus::Font> receiptTitle = makeFont({{L"IBM Plex Mono Medium", Gdiplus::FontStyleRegular},
                                                          {L"Cascadia Mono", Gdiplus::FontStyleRegular},
                                                          {L"Consolas", Gdiplus::FontStyleRegular}},
                                                         10.0F);
  std::unique_ptr<Gdiplus::Font> receiptCount = makeFont({{L"IBM Plex Mono", Gdiplus::FontStyleRegular},
                                                          {L"Cascadia Mono", Gdiplus::FontStyleRegular},
                                                          {L"Consolas", Gdiplus::FontStyleRegular}},
                                                         10.0F);
  std::unique_ptr<Gdiplus::Font> tag = makeFont({{L"IBM Plex Mono SemiBold", Gdiplus::FontStyleRegular},
                                                 {L"Cascadia Mono SemiBold", Gdiplus::FontStyleRegular},
                                                 {L"Consolas", Gdiplus::FontStyleBold}},
                                                10.0F);
  std::unique_ptr<Gdiplus::Font> name = makeFont(
      {{L"IBM Plex Sans SemiBold", Gdiplus::FontStyleRegular}, {L"Segoe UI Semibold", Gdiplus::FontStyleRegular}},
      12.0F);
  std::unique_ptr<Gdiplus::Font> status = makeFont({{L"IBM Plex Mono", Gdiplus::FontStyleRegular},
                                                    {L"Cascadia Mono", Gdiplus::FontStyleRegular},
                                                    {L"Consolas", Gdiplus::FontStyleRegular}},
                                                   10.0F);
  std::unique_ptr<Gdiplus::Font> footnote = makeFont({{L"Segoe UI", Gdiplus::FontStyleRegular}}, 11.0F);
};

Color kindColor(const Palette& colors, Tag kind) {
  switch (kind) {
    case Tag::Waiting: return colors.faint;
    case Tag::Working: return colors.text;
    case Tag::Done: return colors.green;
    case Tag::Later: return colors.amber;
  }
  return colors.faint;
}

std::wstring wide(const std::string& utf8) { return win::widen(utf8); }

}

struct CatalogueView::Impl {
  bool dark = false;
  Fonts fonts;

  bool indeterminate = true;
  double shown = 0, from = 0, to = 0, tweenStart = -1e9, clock = 0;

  [[nodiscard]] static bool anyWorking(const Page& page) {
    return std::any_of(page.rows.begin(), page.rows.end(), [](const Row& row) { return row.kind == Tag::Working; });
  }
};

namespace {

struct TextRun {
  std::wstring text;
  const Gdiplus::Font* font;
  Color color;
  Gdiplus::RectF box;
};

struct BarDraw {
  bool indeterminate;
  double shown;
  double clock;
};

struct GlyphDraw {
  Tag kind;
  Color color;
  Gdiplus::PointF at;
  double clock;
};

class Painter {
 public:
  Painter(Gdiplus::Graphics& graphics, const Palette& colors, Fonts& fonts) : g_(&graphics), c_(&colors), f_(&fonts) {
    g_->SetTextRenderingHint(Gdiplus::TextRenderingHintAntiAliasGridFit);
    g_->SetSmoothingMode(Gdiplus::SmoothingModeNone);
    g_->SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
  }

  void fill(const Color& color, const Gdiplus::RectF& box) {
    const Gdiplus::SolidBrush brush(color);
    g_->FillRectangle(&brush, box);
  }

  void frame(const Color& color, const Gdiplus::RectF& box) {
    fill(color, {box.X, box.Y, box.Width, 1});
    fill(color, {box.X, box.Y + box.Height - 1, box.Width, 1});
    fill(color, {box.X, box.Y, 1, box.Height});
    fill(color, {box.X + box.Width - 1, box.Y, 1, box.Height});
  }

  void label(const TextRun& run, Gdiplus::StringAlignment align = Gdiplus::StringAlignmentNear) {
    Gdiplus::StringFormat format(Gdiplus::StringFormat::GenericTypographic());
    format.SetFormatFlags(format.GetFormatFlags() | Gdiplus::StringFormatFlagsNoWrap);
    format.SetTrimming(Gdiplus::StringTrimmingEllipsisCharacter);
    format.SetAlignment(align);
    format.SetLineAlignment(Gdiplus::StringAlignmentCenter);
    const Gdiplus::SolidBrush brush(run.color);
    g_->DrawString(run.text.c_str(), -1, run.font, run.box, &format, &brush);
  }

  void wrapped(const TextRun& run) {
    Gdiplus::StringFormat format(Gdiplus::StringFormat::GenericTypographic());
    format.SetTrimming(Gdiplus::StringTrimmingNone);
    format.SetLineAlignment(Gdiplus::StringAlignmentNear);
    const Gdiplus::SolidBrush brush(run.color);
    g_->DrawString(run.text.c_str(), -1, run.font, run.box, &format, &brush);
  }

  REAL width(const std::wstring& text, const Gdiplus::Font& font) {
    Gdiplus::StringFormat format(Gdiplus::StringFormat::GenericTypographic());
    format.SetFormatFlags(format.GetFormatFlags() | Gdiplus::StringFormatFlagsNoWrap);
    Gdiplus::RectF box;
    g_->MeasureString(text.c_str(), -1, &font, Gdiplus::RectF(0, 0, 10000, 100), &format, &box);
    return box.Width;
  }

  void bar(const BarDraw& draw, const Gdiplus::RectF& box) {
    fill(c_->paper, box);
    frame(c_->text, box);
    const REAL ix = box.X + 2;
    const REAL iy = box.Y + 2;
    const REAL iw = box.Width - 4;
    const REAL ih = box.Height - 4;
    if (draw.indeterminate) {
      const double phase = std::fmod(draw.clock / 1.4, 2.0);
      const double t = phase < 1 ? phase : 2 - phase;
      const double eased = t < 0.5 ? 4 * t * t * t : 1 - (std::pow((-2 * t) + 2, 3) / 2);
      const REAL block = iw * 0.28F;
      fill(c_->text, {ix + static_cast<REAL>(static_cast<double>(iw - block) * eased), iy, block, ih});
      return;
    }
    fill(c_->text, {ix, iy, std::round(iw * static_cast<REAL>(draw.shown)), ih});
  }

  void glyph(const GlyphDraw& draw) {
    const Tag kind = draw.kind;
    const Color& color = draw.color;
    const REAL x = draw.at.X;
    const REAL y = draw.at.Y;
    const double clock = draw.clock;
    g_->SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
    Gdiplus::Pen pen(color, 1.3F);
    pen.SetLineCap(Gdiplus::LineCapRound, Gdiplus::LineCapRound, Gdiplus::DashCapRound);
    switch (kind) {
      case Tag::Waiting: {
        const std::array<REAL, 2> dashes = {1.6F, 1.6F};
        pen.SetDashPattern(dashes.data(), 2);
        g_->DrawEllipse(&pen, x + 1.5F, y + 1.5F, 9.0F, 9.0F);
        break;
      }
      case Tag::Done: {
        const std::array<Gdiplus::PointF, 3> points = {
            {{x + 2.0F, y + 6.5F}, {x + 5.0F, y + 9.5F}, {x + 10.0F, y + 2.5F}}};
        pen.SetLineJoin(Gdiplus::LineJoinRound);
        g_->DrawLines(&pen, points.data(), 3);
        break;
      }
      case Tag::Later: {
        const std::array<Gdiplus::PointF, 3> points = {
            {{x + 6.0F, y + 1.0F}, {x + 11.0F, y + 10.5F}, {x + 1.0F, y + 10.5F}}};
        pen.SetLineJoin(Gdiplus::LineJoinRound);
        g_->DrawPolygon(&pen, points.data(), 3);
        g_->DrawLine(&pen, x + 6.0F, y + 4.5F, x + 6.0F, y + 7.0F);
        const Gdiplus::SolidBrush dot(color);
        g_->FillEllipse(&dot, x + 5.4F, y + 8.1F, 1.2F, 1.2F);
        break;
      }
      case Tag::Working:
        g_->DrawArc(&pen, x + 1.5F, y + 1.5F, 9.0F, 9.0F, static_cast<REAL>(std::fmod(clock * 400.0, 360.0)), 270.0F);
        break;
    }
    g_->SetSmoothingMode(Gdiplus::SmoothingModeNone);
  }

  void receiptHead(const Page& page, const Gdiplus::RectF& at, REAL cardHeight) {
    const REAL x = at.X;
    const REAL y = at.Y;
    const REAL cardWidth = at.Width;
    fill(c_->text, {x, y + kHeadHeight - 1, cardWidth, 1});
    frame(c_->text, {x, y, cardWidth, cardHeight});
    const std::wstring title = wide(say(page.language, Text::ReceiptTitle));
    label({title, f_->receiptTitle.get(), c_->text, Gdiplus::RectF(x + 12, y + 5, cardWidth - 120, 14)});
    label({wide(page.versionCount), f_->receiptCount.get(), c_->muted,
           Gdiplus::RectF(x + cardWidth - 112, y + 5, 100, 14)},
          Gdiplus::StringAlignmentFar);
  }

  REAL receipt(const Page& page, const Gdiplus::RectF& at, double clock) {
    const REAL x = at.X;
    const REAL y = at.Y;
    const REAL cardWidth = at.Width;
    std::vector<REAL> heights;
    REAL top = kHeadHeight;
    for (const Row& row : page.rows) {
      const REAL lines = width(wide(row.status), *f_->status) > cardWidth - 2 - kTagWidth - 12 ? 2.0F : 1.0F;
      heights.push_back(kRowHeight + ((lines - 1) * 13));
      top += heights.back();
    }
    const REAL cardHeight = top + 1;
    fill(c_->drop, {x + kDrop, y + kDrop, cardWidth, cardHeight});
    fill(c_->paper, {x, y, cardWidth, cardHeight});
    REAL rowY = kHeadHeight;
    for (std::size_t index = 0; index < page.rows.size(); index++) {
      const Row& row = page.rows[index];
      const REAL rowH = heights[index];
      const REAL ry = y + rowY;
      const REAL rx = x + 1;
      if (row.kind == Tag::Later) fill(c_->amberSoft, {rx, ry, cardWidth - 2, rowH});
      fill(index + 1 < page.rows.size() ? c_->line : c_->paper, {rx, ry + rowH - 1, cardWidth - 2, 1});
      const Color color = kindColor(*c_, row.kind);
      glyph({row.kind, color, {rx + 12, ry + 12}, clock});
      label({wide(row.tag), f_->tag.get(), color, Gdiplus::RectF(rx + 30, ry + 11, kTagWidth - 30, 14)});
      label({wide(row.name), f_->name.get(), c_->text,
             Gdiplus::RectF(rx + kTagWidth, ry + (row.status.empty() ? 11.0F : 4.0F), cardWidth - 2 - kTagWidth - 12,
                            16)});
      if (!row.status.empty()) {
        wrapped({wide(row.status), f_->status.get(), c_->faint,
                 Gdiplus::RectF(rx + kTagWidth, ry + 20, cardWidth - 2 - kTagWidth - 12, 28)});
      }
      rowY += rowH;
    }
    receiptHead(page, at, cardHeight);
    return cardHeight + kDrop;
  }

  Gdiplus::Graphics& graphics() { return *g_; }

 private:
  Gdiplus::Graphics* g_;
  const Palette* c_;
  Fonts* f_;
};

}

CatalogueView::CatalogueView() : impl_(std::make_unique<Impl>()) { page.showStarting(); }

CatalogueView::~CatalogueView() = default;

void CatalogueView::setDark(bool dark) { impl_->dark = dark; }

void CatalogueView::syncBar() {
  Impl& bar = *impl_;
  if (page.bar.indeterminate) {
    bar.indeterminate = true;
    return;
  }
  if (bar.indeterminate) bar.shown = bar.from = 0;
  bar.indeterminate = false;
  bar.from = bar.shown;
  bar.to = std::max(0.0, std::min(1.0, page.bar.fraction));
  bar.tweenStart = bar.clock;
}

unsigned CatalogueView::step(double now) {
  Impl& bar = *impl_;
  bar.clock = now;
  const double t = std::min(1.0, (now - bar.tweenStart) / static_cast<double>(kBarTween));
  const double eased = 1 - std::pow(1 - t, 3);
  const double next = bar.from + ((bar.to - bar.from) * eased);
  unsigned dirty = kNothing;
  if (bar.indeterminate || next != bar.shown) {
    bar.shown = next;
    if (!page.bar.hidden) dirty |= kBar;
  }
  if (Impl::anyWorking(page)) dirty |= kSpinner;
  return dirty;
}

std::unique_ptr<Gdiplus::Bitmap> CatalogueView::render(float scale, double now, bool withFooter) {
  const REAL height = kPageHeight + (withFooter ? kFooter : 0);
  auto bitmap = std::make_unique<Gdiplus::Bitmap>(static_cast<INT>(std::lround(kWidth * scale)),
                                                  static_cast<INT>(std::lround(height * scale)), PixelFormat32bppPARGB);
  Gdiplus::Graphics graphics(bitmap.get());
  graphics.ScaleTransform(scale, scale);
  const Palette colors = palette(impl_->dark);
  Painter painter(graphics, colors, impl_->fonts);
  Impl& state = *impl_;
  state.clock = now;

  const REAL width = kWidth - (2 * kPad);
  painter.fill(colors.paper, {0, 0, kWidth, height});
  painter.fill(colors.band, {0, 0, kWidth, kBandHeight});
  painter.fill(colors.onBand, {kPad, 22, 18, 1.5F});
  painter.label({wide(page.eyebrow), state.fonts.eyebrow.get(), colors.onBandMuted,
                 Gdiplus::RectF(kPad + 26, 16, width - 26, 13)});
  painter.label({wide(page.heading), state.fonts.heading.get(), colors.onBand, Gdiplus::RectF(kPad, 34, width, 22)});
  if (!page.bar.hidden) {
    painter.bar({state.indeterminate, state.shown, state.clock}, Gdiplus::RectF(kPad, kBandHeight + 18, width, 10));
  }
  painter.label(
      {wide(page.detail), state.fonts.detail.get(), colors.muted, Gdiplus::RectF(kPad, kBandHeight + 34, width, 16)});
  REAL noteTop = kBandHeight + 62;
  if (!page.rows.empty()) noteTop += painter.receipt(page, {kPad, kBandHeight + 62, width, 0}, now) + 14;
  painter.wrapped({wide(page.note), state.fonts.note.get(), colors.muted,
                   Gdiplus::RectF(kPad, noteTop, width, std::max(0.0F, kPageHeight - noteTop - 12))});
  if (withFooter && !footnote.empty()) {
    painter.label({footnote, state.fonts.footnote.get(), colors.faint,
                   Gdiplus::RectF(16, kPageHeight + 18, kWidth - (3 * 16) - 88, 16)});
  }
  return bitmap;
}

}

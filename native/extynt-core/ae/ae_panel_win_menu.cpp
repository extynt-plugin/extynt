// The panel's context menu: Edge's own menu, trimmed to Cut, Copy, Paste and Select All (and Inspect in a
// development-library build) by the same rules as the macOS panel (core/panel_page.h, keepContextMenuItem). The entries
// to remove are every command the rules drop, then the separators the drops leave doubled or at an end.
#include <windows.h>

#include <algorithm>
#include <cstddef>
#include <string>
#include <vector>

#include "ae_log.h"
#include "ae_panel_win_panel.h"
#include "library_files.h"
#include "panel_menu.h"

namespace extynt::ae::panel {

namespace {

struct MenuEntry {
  MenuItemFacts facts;
  bool separator = false;
};

MenuEntry entryOf(ICoreWebView2ContextMenuItem* item) {
  MenuEntry entry;
  LPWSTR name = nullptr;
  LPWSTR label = nullptr;
  COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND;
  item->get_Name(&name);
  item->get_Label(&label);
  item->get_Kind(&kind);
  entry.facts.identifier = takeString(name);
  entry.facts.title = takeString(label);
  entry.facts.hasSubmenu = kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU;
  entry.separator = kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR;
  return entry;
}

std::vector<MenuEntry> entriesOf(ICoreWebView2ContextMenuItemCollection* items) {
  UINT count = 0;
  items->get_Count(&count);
  std::vector<MenuEntry> entries;
  for (UINT i = 0; i < count; ++i) {
    ComRef<ICoreWebView2ContextMenuItem> item;
    items->GetValueAtIndex(i, item.put());
    entries.push_back(item ? entryOf(item.get()) : MenuEntry());
  }
  return entries;
}

std::vector<std::size_t> indicesToRemove(const std::vector<MenuEntry>& entries, std::string& report) {
  std::vector<bool> separator;
  std::vector<bool> kept;
  std::vector<std::size_t> removed;
  for (std::size_t i = 0; i < entries.size(); ++i) {
    const MenuEntry& entry = entries[i];
    const bool keep = entry.separator || keepContextMenuItem(entry.facts, devLibraryBuild());
    separator.push_back(entry.separator);
    kept.push_back(keep);
    if (entry.separator) continue;
    report += (keep ? " +" : " -") + entry.facts.identifier + "(" + entry.facts.title + ")";
    if (!keep) removed.push_back(i);
  }
  for (const std::size_t at : redundantSeparators(separator, kept)) removed.push_back(at);
  std::sort(removed.begin(), removed.end());
  return removed;
}

}

void WinPanel::trimContextMenu(ICoreWebView2ContextMenuRequestedEventArgs* args) {
  ComRef<ICoreWebView2ContextMenuItemCollection> items;
  args->get_MenuItems(items.put());
  if (!items) return;
  std::string report;
  const std::vector<std::size_t> removed = indicesToRemove(entriesOf(items.get()), report);
  for (auto at = removed.rbegin(); at != removed.rend(); ++at) items->RemoveValueAtIndex(static_cast<UINT>(*at));
  logLine("panel: context menu (+ kept, - dropped):" + (report.empty() ? std::string(" none") : report));
}

}

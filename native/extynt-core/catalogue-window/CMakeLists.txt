# "extynt Catalogue.exe": the small window the Windows installer opens after install to learn the installed effects
# (the counterpart of packaging/macos/release/catalogue-window "extynt Catalogue.app"). Windows only, built with the
# plugin (add_subdirectory from the top-level CMakeLists.txt). No runtime dependency beyond what Windows ships: GDI+ draws,
# WinHTTP talks to the sidecar. Output: <build>/catalogue-window/<config>/extynt Catalogue.exe
if(NOT MSVC)
  message(FATAL_ERROR "The catalogue window is built with MSVC (Visual Studio 2022).")
endif()

add_executable(extynt_catalogue_window WIN32
  catalogue_window_win.cpp
  catalogue_view_win.cpp
  catalogue_launch_win.cpp
  catalogue_engine_win.cpp
  sdk_win_catalogue.cpp
  catalogue_preview_win.cpp
  catalogue_window_win.rc)
# The extynt logo, embedded as the window and exe icon straight from the packaging tree (not copied).
set(EXTYNT_ICON_FILE "${CMAKE_CURRENT_SOURCE_DIR}/../../../packaging/windows/branding/extynt.ico")
if(NOT EXISTS "${EXTYNT_ICON_FILE}")
  message(FATAL_ERROR "Missing ${EXTYNT_ICON_FILE}: the catalogue window embeds it as its icon.")
endif()
set_source_files_properties(catalogue_window_win.rc PROPERTIES
  OBJECT_DEPENDS "${EXTYNT_ICON_FILE}"
  COMPILE_DEFINITIONS "EXTYNT_ICON_PATH=\"${EXTYNT_ICON_FILE}\"")
set_target_properties(extynt_catalogue_window PROPERTIES OUTPUT_NAME "extynt Catalogue")
target_link_libraries(extynt_catalogue_window PRIVATE extynt_catalogue_status extynt_transport
  gdiplus winhttp user32 gdi32 dwmapi uxtheme shell32 advapi32 ole32)
target_compile_definitions(extynt_catalogue_window PRIVATE UNICODE _UNICODE)
extynt_apply_flags(extynt_catalogue_window)
# The Windows SDK's GDI+ headers are not ours: their warnings stay out of the /WX build.
target_compile_options(extynt_catalogue_window PRIVATE /external:anglebrackets /external:W0)

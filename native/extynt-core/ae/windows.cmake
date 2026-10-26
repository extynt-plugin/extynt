# The After Effects plugin on Windows: extyntcore.aex (a DLL with the .aex suffix), built with MSVC. Included from
# ae/CMakeLists.txt, after AE_SDK_EXAMPLES is known. Nothing from the SDK or WebView2 is copied into this repository.
#   cmake -S native/extynt-core -B build-win -A x64 -DEXTYNT_BUILD_PLUGIN=ON -DAE_SDK_ROOT=<AfterEffectsSDK> \
#     -DWEBVIEW2_ROOT=<unpacked Microsoft.Web.WebView2 NuGet package>
# build-win.ps1 at the top of native/extynt-core does this, including the NuGet download.

if(NOT MSVC)
  message(FATAL_ERROR "The Windows plugin is built with MSVC (Visual Studio 2022). mingw-w64 only serves the Linux syntax check.")
endif()
set(WEBVIEW2_ROOT "" CACHE PATH "Unpacked Microsoft.Web.WebView2 NuGet package (the folder with build/native)")
if(NOT EXISTS "${WEBVIEW2_ROOT}/build/native/include/WebView2.h")
  message(FATAL_ERROR "WEBVIEW2_ROOT=${WEBVIEW2_ROOT} does not contain build/native/include/WebView2.h. build-win.ps1 fetches the package.")
endif()
if(CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64" OR CMAKE_SYSTEM_PROCESSOR MATCHES "ARM64|arm64")
  set(EXTYNT_WEBVIEW2_ARCH arm64)
else()
  set(EXTYNT_WEBVIEW2_ARCH x64)
endif()
set(EXTYNT_WEBVIEW2_LOADER "${WEBVIEW2_ROOT}/build/native/${EXTYNT_WEBVIEW2_ARCH}/WebView2LoaderStatic.lib")
if(NOT EXISTS "${EXTYNT_WEBVIEW2_LOADER}")
  message(FATAL_ERROR "${EXTYNT_WEBVIEW2_LOADER} is missing from the WebView2 package.")
endif()

# PiPL: cl preprocesses the .r, PiPLTool turns it into resource text, cl preprocesses that into the .rc.
set(EXTYNT_PIPL_R "${CMAKE_CURRENT_SOURCE_DIR}/extyntcore_PiPL.r")
set(EXTYNT_PIPL_RR "${CMAKE_CURRENT_BINARY_DIR}/extyntcore_PiPL.rr")
set(EXTYNT_PIPL_RRC "${CMAKE_CURRENT_BINARY_DIR}/extyntcore_PiPL.rrc")
set(EXTYNT_PIPL_RC "${CMAKE_CURRENT_BINARY_DIR}/extyntcore_PiPL.rc")
add_custom_command(
  OUTPUT "${EXTYNT_PIPL_RC}"
  COMMAND "${CMAKE_CXX_COMPILER}" /nologo /I "${AE_SDK_EXAMPLES}/Headers" /EP /P "/Fi${EXTYNT_PIPL_RR}" "${EXTYNT_PIPL_R}"
  COMMAND "${AE_SDK_EXAMPLES}/Resources/PiPLtool.exe" "${EXTYNT_PIPL_RR}" "${EXTYNT_PIPL_RRC}"
  COMMAND "${CMAKE_CXX_COMPILER}" /nologo /D MSWindows /EP /P "/Fi${EXTYNT_PIPL_RC}" "${EXTYNT_PIPL_RRC}"
  DEPENDS "${EXTYNT_PIPL_R}"
  COMMENT "Compiling the PiPL"
  VERBATIM)

add_library(extynt_ae_plugin MODULE
  ae_entry.cpp
  sdk_entry.cpp
  ae_log.cpp
  ae_panel_win.cpp
  ae_panel_win_focus.cpp
  ae_panel_win_host.cpp
  ae_panel_win_keys.cpp
  ae_panel_win_load.cpp
  ae_panel_win_menu.cpp
  ae_panel_win_options.cpp
  ae_panel_win_view.cpp
  ae_platform_win.cpp
  ae_dialog_probe_win.cpp
  ae_dialog_scan_win.cpp
  sdk_win_ae.cpp
  sdk_win_com.cpp
  sdk_win_image.cpp
  sdk_win_module.cpp
  sdk_win_socket.cpp
  sdk_win_window.cpp
  ae_engine_network_win.cpp
  ae_plugin_layout_win.cpp
  ae_suites.cpp
  ae_reader.cpp
  ae_reader_layer.cpp
  ae_reader_stream.cpp
  ae_stream_bridge.cpp
  ae_stream_ops.cpp
  ae_reader_effect.cpp
  ae_reader_digest.cpp
  "${EXTYNT_PIPL_RC}")

target_include_directories(extynt_ae_plugin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_include_directories(extynt_ae_plugin SYSTEM PRIVATE
  "${AE_SDK_EXAMPLES}/Headers"
  "${AE_SDK_EXAMPLES}/Headers/SP"
  "${AE_SDK_EXAMPLES}/Resources"
  "${WEBVIEW2_ROOT}/build/native/include")
target_compile_definitions(extynt_ae_plugin PRIVATE
  MSWindows WIN32 _WINDOWS EXTYNT_PLUGIN_VERSION="${EXTYNT_PLUGIN_VERSION}")
target_link_libraries(extynt_ae_plugin PRIVATE extynt_transport "${EXTYNT_WEBVIEW2_LOADER}"
  version shell32 ole32 user32 advapi32 ws2_32)
extynt_apply_flags(extynt_ae_plugin)
# The SDK headers are not ours: their warnings stay out of the /WX build.
target_compile_options(extynt_ae_plugin PRIVATE /external:W0)
set_target_properties(extynt_ae_plugin PROPERTIES PREFIX "" SUFFIX ".aex" OUTPUT_NAME "extyntcore")

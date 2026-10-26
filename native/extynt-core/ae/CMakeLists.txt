# The After Effects plugin (macOS; the Windows .aex is windows.cmake). Included from the top-level CMakeLists when EXTYNT_BUILD_PLUGIN=ON.
# Adobe's SDK is only referenced by path (AE_SDK_ROOT); nothing from it is copied into this repository.

if(NOT AE_SDK_ROOT)
  message(FATAL_ERROR "AE_SDK_ROOT is not set. Point it at the unpacked After Effects SDK, e.g. -DAE_SDK_ROOT=\"$HOME/SDKs/AdobeAfterEffectsSDK_26.5_MacOS\"")
endif()
if(EXISTS "${AE_SDK_ROOT}/Examples/Headers/AE_GeneralPlug.h")
  set(AE_SDK_EXAMPLES "${AE_SDK_ROOT}/Examples")
elseif(EXISTS "${AE_SDK_ROOT}/Headers/AE_GeneralPlug.h")
  set(AE_SDK_EXAMPLES "${AE_SDK_ROOT}")
else()
  message(FATAL_ERROR "AE_SDK_ROOT=${AE_SDK_ROOT} does not contain Examples/Headers/AE_GeneralPlug.h (nor Headers/AE_GeneralPlug.h).")
endif()
message(STATUS "After Effects SDK headers: ${AE_SDK_EXAMPLES}/Headers")

if(WIN32)
  include("${CMAKE_CURRENT_SOURCE_DIR}/windows.cmake")
  return()
endif()

configure_file("${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in" "${CMAKE_CURRENT_BINARY_DIR}/Info.plist" @ONLY)

# The native-panel experiment is Objective-C++ (compiled with ARC); everything else stays plain C++.
enable_language(OBJCXX)
set(CMAKE_OBJCXX_STANDARD 17)
set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)

add_library(extynt_ae_plugin MODULE
  ae_entry.cpp
  sdk_entry.cpp
  ae_log.cpp
  ae_engine_hide_mac.mm
  ae_panel_diag.mm
  ae_panel_mac.mm
  ae_panel_monitor.mm
  ae_panel_view.mm
  ae_panel_page.mm
  ae_stream_bridge.cpp
  ae_stream_ops.cpp
  ae_suites.cpp
  ae_reader.cpp
  ae_reader_layer.cpp
  ae_reader_stream.cpp
  ae_reader_effect.cpp
  ae_reader_digest.cpp
  ae_platform_mac.cpp
  ae_dialog_probe_mac.cpp
  ae_plugin_layout_mac.cpp)

target_include_directories(extynt_ae_plugin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
# SYSTEM keeps the SDK's own warnings out of our build log.
target_include_directories(extynt_ae_plugin SYSTEM PRIVATE
  "${AE_SDK_EXAMPLES}/Headers"
  "${AE_SDK_EXAMPLES}/Headers/SP"
  "${AE_SDK_EXAMPLES}/Resources")
target_link_libraries(extynt_ae_plugin PRIVATE extynt_transport "-framework CoreFoundation" "-framework CoreGraphics" "-framework Cocoa" "-framework WebKit" "-framework UniformTypeIdentifiers")
target_compile_definitions(extynt_ae_plugin PRIVATE EXTYNT_PLUGIN_VERSION="${EXTYNT_PLUGIN_VERSION}")
extynt_apply_flags(extynt_ae_plugin)
target_compile_options(extynt_ae_plugin PRIVATE -fvisibility=hidden -fvisibility-inlines-hidden)
# ARC is required for every .mm; the missing-super check catches an overridden Cocoa method that forgets to chain up.
target_compile_options(extynt_ae_plugin PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc -Wobjc-missing-super-calls>)
target_link_options(extynt_ae_plugin PRIVATE -Wl,-dead_strip)

# Bundle layout the samples use: <name>.plugin, package type AEgx, executable and .rsrc named after the product.
set_target_properties(extynt_ae_plugin PROPERTIES
  BUNDLE TRUE
  BUNDLE_EXTENSION "plugin"
  PREFIX ""
  OUTPUT_NAME "extyntcore"
  MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/Info.plist")

# PiPL: Rez compiles extyntcore_PiPL.r into Contents/Resources/extyntcore.rsrc, like Xcode's Resources phase.
add_custom_command(TARGET extynt_ae_plugin POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_BUNDLE_CONTENT_DIR:extynt_ae_plugin>/Resources"
  COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/rez_pipl.sh" "${AE_SDK_EXAMPLES}"
          "${CMAKE_CURRENT_SOURCE_DIR}/extyntcore_PiPL.r"
          "$<TARGET_BUNDLE_CONTENT_DIR:extynt_ae_plugin>/Resources/extyntcore.rsrc"
  COMMENT "Compiling the PiPL with Rez"
  VERBATIM)

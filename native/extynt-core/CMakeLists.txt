cmake_minimum_required(VERSION 3.20)
project(extynt_core VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
# Only EntryPointFunc is exported from the plugin; everything else stays private to the bundle.
# (MSVC hides everything that is not __declspec(dllexport) already.)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

option(EXTYNT_BUILD_TESTS "Build the pure-core unit tests (Linux or macOS, no SDK needed)" ON)
option(EXTYNT_BUILD_PLUGIN "Build the After Effects plugin (macOS or Windows, needs AE_SDK_ROOT)" OFF)
set(AE_SDK_ROOT "" CACHE PATH "Adobe After Effects SDK folder (the one that contains Examples/, or Examples/ itself). Never copied into this repo.")
set(EXTYNT_PLUGIN_VERSION "0.1.0" CACHE STRING "Version string reported by the plugin")

# The release plugin reads the host jsx library only from the root-owned /Library/Application Support/extynt/host. With
# this option ON it also reads ~/Library/Application Support/extynt/host, which any user process can write: dev builds only.
option(EXTYNT_DEV_LIBRARY "Also search the user-writable library directory (development builds only)" OFF)

# Debug build with AddressSanitizer and UndefinedBehaviorSanitizer; the gate runs the tests in Release and in this mode.
option(EXTYNT_SANITIZE "Build every target with -fsanitize=address,undefined" OFF)

find_package(Threads REQUIRED)

# Windows hands CreateProcess a UTF-16 world; keep the Win32 headers lean and min/max out of the way.
if(WIN32)
  add_compile_definitions(WIN32_LEAN_AND_MEAN NOMINMAX)
endif()

# One warning set for every target we own. Warnings are errors, so a Mac build fails exactly like the Linux gate.
if(MSVC)
  # /W4 plus the shadowing, conversion and sign warnings /W4 leaves off, all as errors: the MSVC counterpart of the set below.
  # /w14265 (the MSVC form of -Wnon-virtual-dtor) is left out: the hand-rolled COM classes in ae_panel_win_com.h and
  # ae_panel_win_options.cpp inherit virtual methods from COM interfaces whose destructors are non-virtual by design.
  set(EXTYNT_WARNING_FLAGS /W4 /w14242 /w14254 /w14263 /w14287 /w14296 /w14311 /w14545 /w14546 /w14547
    /w14549 /w14555 /w14619 /w14640 /w14826 /w14905 /w14906 /w14928 /permissive- /utf-8 /Zc:__cplusplus /EHsc /WX)
else()
  set(EXTYNT_WARNING_FLAGS
    -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wsign-conversion -Wnon-virtual-dtor -Wold-style-cast
    -Woverloaded-virtual -Wnull-dereference -Wdouble-promotion -Wformat=2 -Wimplicit-fallthrough -Wcast-align
    -Wunused -Werror)
endif()
set(EXTYNT_SANITIZE_FLAGS -fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all)

function(extynt_apply_flags target)
  target_compile_options(${target} PRIVATE ${EXTYNT_WARNING_FLAGS})
  if(EXTYNT_SANITIZE)
    target_compile_options(${target} PRIVATE ${EXTYNT_SANITIZE_FLAGS})
    target_link_options(${target} PRIVATE ${EXTYNT_SANITIZE_FLAGS})
  endif()
endfunction()

# Pure core: no SDK, no OS APIs beyond the C++ standard library.
add_library(extynt_core STATIC
  core/json_writer.cpp
  core/json_tree.cpp
  core/json_decode.cpp
  core/hash128.cpp
  core/path_segments.cpp
  core/request.cpp
  core/request_id.cpp
  core/log_format.cpp
  core/request_host.cpp
  core/host_entries.cpp
  core/host_version.cpp
  core/host_call.cpp
  core/effect_menus.cpp
  core/watch.cpp
  core/library_locate.cpp
  core/dialog_probe.cpp
  core/pipl.cpp
  core/options_dialogs.cpp
  core/timing.cpp
  core/text_decode.cpp
  core/layer_rules.cpp
  core/walker.cpp
  core/walker_json.cpp
  core/walker_paths.cpp
  core/walker_tree.cpp
  core/write_ops.cpp
  core/session_port.cpp
  core/panel_menu.cpp
  core/panel_page.cpp
  core/panel_theme.cpp
  core/panel_nav.cpp
  core/panel_keys_win.cpp
  core/executor.cpp
  core/host_mode.cpp
  core/stream_policy.cpp
  core/stream_request.cpp)
target_include_directories(extynt_core PUBLIC core)
# SYSTEM: third-party headers are not ours to warn about.
target_include_directories(extynt_core SYSTEM PUBLIC third_party/xxhash)

# Socket server and discovery file, still no SDK. The platform half is chosen here: POSIX (macOS, and Linux for the
# tests) or Windows (Winsock and the shell's known folders). Linux-testable, and cross-compilable for Windows.
if(WIN32)
  set(EXTYNT_PLATFORM_SOURCES
    transport/net_win.cpp
    transport/sdk_winsock.cpp
    transport/home_directory_win.cpp
    transport/discovery_win.cpp
    transport/child_process_win.cpp
    transport/library_paths_win.cpp
    transport/windows_paths.cpp)
else()
  set(EXTYNT_PLATFORM_SOURCES
    transport/net_posix.cpp
    transport/sdk_posix_socket.cpp
    transport/home_directory_posix.cpp
    transport/discovery_posix.cpp
    transport/sdk_posix_open.cpp
    transport/child_process_posix.cpp
    transport/library_paths_posix.cpp)
endif()
add_library(extynt_transport STATIC
  ${EXTYNT_PLATFORM_SOURCES}
  transport/home_directory.cpp
  transport/discovery.cpp
  transport/event_hub.cpp
  transport/exchange_folder.cpp
  transport/idle_turn.cpp
  transport/launch_agent.cpp
  transport/library_files.cpp
  transport/plugin_files.cpp
  transport/options_dialog_index.cpp
  transport/server.cpp
  transport/sidecar_watch.cpp)
target_include_directories(extynt_transport PUBLIC transport)
if(WIN32)
  target_link_libraries(extynt_transport PUBLIC ws2_32 bcrypt shell32 ole32 uuid)
endif()
if(EXTYNT_DEV_LIBRARY)
  target_compile_definitions(extynt_transport PRIVATE EXTYNT_DEV_LIBRARY_BUILD=1)
else()
  target_compile_definitions(extynt_transport PRIVATE EXTYNT_DEV_LIBRARY_BUILD=0)
endif()
target_link_libraries(extynt_transport PUBLIC extynt_core Threads::Threads)

# What the catalogue window says and when (pure C++): shared by the Windows window and the unit tests.
add_library(extynt_catalogue_status STATIC
  catalogue-window/catalogue_status.cpp
  catalogue-window/canned_status.cpp
  catalogue-window/catalogue_text.cpp
  catalogue-window/catalogue_text_en.cpp
  catalogue-window/catalogue_text_es.cpp
  catalogue-window/catalogue_text_de.cpp
  catalogue-window/catalogue_text_fr.cpp
  catalogue-window/catalogue_text_ja.cpp
  catalogue-window/catalogue_text_zh.cpp)
target_include_directories(extynt_catalogue_status PUBLIC catalogue-window)
target_link_libraries(extynt_catalogue_status PUBLIC extynt_core)

extynt_apply_flags(extynt_core)
extynt_apply_flags(extynt_transport)
extynt_apply_flags(extynt_catalogue_status)

if(EXTYNT_BUILD_TESTS)
  enable_testing()
  set(EXTYNT_TEST_SOURCES
    tests/test_main.cpp
    tests/test_util.cpp
    tests/test_walker.cpp
    tests/test_content_hash.cpp
    tests/test_text.cpp
    tests/test_panel_page.cpp
    tests/test_panel_native.cpp
    tests/test_panel_keys_win.cpp
    tests/test_write_ops.cpp
    tests/test_batch.cpp
    tests/test_effects.cpp
    tests/test_dispatch.cpp
    tests/test_server.cpp
    tests/test_home_directory.cpp
    tests/test_host_call.cpp
    tests/test_effect_menus.cpp
    tests/test_host_version.cpp
    tests/test_watch.cpp
    tests/test_event_hub.cpp
    tests/test_launch_agent.cpp
    tests/test_request_id.cpp
    tests/test_log_format.cpp
    tests/test_server_events.cpp
    tests/test_library_locate.cpp
    tests/test_dialog_probe.cpp
    tests/test_catalogue_status.cpp
    tests/test_catalogue_text.cpp
    tests/test_catalogue_literals.cpp
    tests/test_pipl.cpp
    tests/test_plugin_files.cpp
    tests/test_launch_windows.cpp
    tests/test_sidecar_watch.cpp
    tests/test_host_mode.cpp
    tests/test_json_decode.cpp
    tests/test_stream_policy.cpp
    tests/test_exchange_folder.cpp
    tests/fake_host.cpp)
  if(WIN32)
    # These assert macOS paths or run POSIX programs (/usr/bin/true); the Windows counterparts are the *_windows tests.
    list(REMOVE_ITEM EXTYNT_TEST_SOURCES tests/test_launch_agent.cpp tests/test_library_locate.cpp)
  endif()
  add_executable(extynt_core_tests ${EXTYNT_TEST_SOURCES})
  target_link_libraries(extynt_core_tests PRIVATE extynt_transport extynt_catalogue_status)
  target_compile_definitions(extynt_core_tests PRIVATE EXTYNT_VECTORS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/vectors"
  EXTYNT_CATALOGUE_WINDOW_DIR="${CMAKE_CURRENT_SOURCE_DIR}/catalogue-window")
  extynt_apply_flags(extynt_core_tests)
  add_test(NAME extynt_core_tests COMMAND extynt_core_tests)
  if(NOT WIN32)  # a POSIX tool (sigwait) for the spike scripts
    add_executable(extynt_fake_server tests/fake_server_main.cpp tests/fake_host.cpp)
    target_link_libraries(extynt_fake_server PRIVATE extynt_transport)
    extynt_apply_flags(extynt_fake_server)
  endif()
endif()

if(EXTYNT_BUILD_PLUGIN)
  if(NOT APPLE AND NOT WIN32)
    message(FATAL_ERROR "EXTYNT_BUILD_PLUGIN needs macOS or Windows.")
  endif()
  add_subdirectory(ae)
  if(WIN32)
    add_subdirectory(catalogue-window)
  endif()
endif()

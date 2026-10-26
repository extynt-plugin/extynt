// The pure parts of the Windows sidecar kickstart: the schtasks arguments and CreateProcessW command-line quoting.
#include <string>
#include <vector>

#include "launch_agent.h"
#include "testing.h"

using namespace extynt;

namespace {

TEST(schtasks_arguments_run_the_named_task_and_never_end_it) {
  const std::vector<std::string> expected = {"schtasks.exe", "/Run", "/TN", "extynt sidecar"};
  CHECK(schtasksArguments("extynt sidecar") == expected);
}

TEST(the_sidecar_task_is_named_for_its_account_with_unsafe_characters_replaced) {
  CHECK_EQ(sidecarTaskName(L"Alice"), std::string("extynt sidecar Alice"));
  CHECK_EQ(sidecarTaskName(L"ana.lu-1_x"), std::string("extynt sidecar ana.lu-1_x"));
  CHECK_EQ(sidecarTaskName(L"Ana Lu\\k"), std::string("extynt sidecar Ana_Lu_k"));
  CHECK_EQ(sidecarTaskName(L"Alic\u00e9"), std::string("extynt sidecar Alic_"));
}

TEST(a_command_line_quotes_only_what_needs_it) {
  CHECK_EQ(windowsCommandLine({"schtasks.exe", "/Run", "/TN", "extynt sidecar"}),
           std::string("schtasks.exe /Run /TN \"extynt sidecar\""));
  CHECK_EQ(windowsCommandLine({"a", "", "b"}), std::string("a \"\" b"));
  CHECK_EQ(windowsCommandLine({}), std::string());
}

TEST(a_command_line_doubles_backslashes_only_before_a_quote) {
  CHECK_EQ(windowsCommandLine({"C:\\Program Files\\x"}), std::string("\"C:\\Program Files\\x\""));
  CHECK_EQ(windowsCommandLine({"a b\\"}), std::string("\"a b\\\\\""));
  CHECK_EQ(windowsCommandLine({"say \"hi\""}), std::string("\"say \\\"hi\\\"\""));
  CHECK_EQ(windowsCommandLine({"q\\\"x y"}), std::string("\"q\\\\\\\"x y\""));
}

}

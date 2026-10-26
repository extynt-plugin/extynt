// Tests for resolving the user's home directory.
#include <string>

#include "home_directory.h"
#include "testing.h"

using namespace extynt;

namespace {

TEST(home_directory_prefers_a_non_empty_environment_home) {
  CHECK_EQ(chooseHomeDirectory("/env/home", "/account/home"), std::string("/env/home"));
  CHECK_EQ(chooseHomeDirectory("/env/home", ""), std::string("/env/home"));
}

TEST(home_directory_falls_back_to_the_account_home_when_the_environment_is_empty) {
  CHECK_EQ(chooseHomeDirectory("", "/account/home"), std::string("/account/home"));
  CHECK_EQ(chooseHomeDirectory("", ""), std::string(""));
}

TEST(home_directory_is_stable_and_names_an_absolute_folder_when_it_names_one) {
  const std::string first = homeDirectory();
  CHECK_EQ(homeDirectory(), first);
  const std::string account = accountHomeDirectory();
  CHECK(account.empty() || account.front() == '/');
  CHECK(first.empty() || first.front() == '/');
}

}

#pragma once
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <winsock2.h>
#include <windows.h>
#include <fwpmu.h>
#include <array>
#include <string>
#include <vector>

namespace CourseforgeNetwork {
// Trusted broker inputs only. No public worker/HTML endpoint or activation entry point.
struct PolicyIdentity {
  GUID provider;
  GUID sublayer;
  GUID lease;
  unsigned long long generation;
  std::array<unsigned char, 32> planDigest;
  std::wstring packageSid;
};
struct Endpoint {
  enum class Family { V4, V6 };
  Family family;
  unsigned short port; // Literal 127.0.0.1 or ::1 only, always TCP.
};
struct PolicyPlan {
  PolicyIdentity identity;
  bool denyAll;
  Endpoint endpoint;
  std::vector<GUID> filterKeys; // Durable, exclusive keys allocated BEFORE any native write.
};
enum class PolicyResult { Matched, Rejected, RecoveryRequired };

// Explicit privileged calls. Never invoked by constructors, build, tests or the current worker.
// Caller must own a durable exclusive package lease and authenticated channel.
PolicyResult InstallInitialDenyAll(const PolicyPlan& plan) noexcept;
PolicyResult ReplaceOwnedPolicy(const PolicyPlan& previous, const PolicyPlan& next) noexcept;
PolicyResult ReadOwnedPolicy(const PolicyPlan& plan) noexcept;
}

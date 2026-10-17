#include "WfpNetworkPolicy.h"
#include <cstring>
#include <stdexcept>

namespace {
constexpr UINT32 MaximumRecordBytes = 512;
class Reader {
  const unsigned char* bytes; size_t size, offset = 0;
public:
  Reader(const unsigned char* source, UINT32 length) : bytes(source), size(length) {
    if (!source || length == 0 || length > MaximumRecordBytes) throw std::invalid_argument("record");
  }
  void Copy(void* destination, size_t count) {
    if (count > size - offset) throw std::invalid_argument("record");
    std::memcpy(destination, bytes + offset, count); offset += count;
  }
  unsigned long long Integer(size_t count) {
    if (count > 8) throw std::invalid_argument("record");
    unsigned char buffer[8]{}; Copy(buffer, count); unsigned long long result = 0;
    for (size_t index = 0; index < count; ++index) result |= static_cast<unsigned long long>(buffer[index]) << (index * 8);
    return result;
  }
  void End() const { if (offset != size) throw std::invalid_argument("record"); }
};
CourseforgeNetwork::PolicyPlan Decode(const unsigned char* bytes, UINT32 size) {
  Reader reader(bytes, size); CourseforgeNetwork::PolicyPlan plan{};
  if (reader.Integer(4) != 1) throw std::invalid_argument("version");
  reader.Copy(&plan.identity.provider, sizeof(GUID)); reader.Copy(&plan.identity.sublayer, sizeof(GUID));
  reader.Copy(&plan.identity.lease, sizeof(GUID)); plan.identity.generation = reader.Integer(8);
  reader.Copy(plan.identity.planDigest.data(), plan.identity.planDigest.size());
  const auto mode = reader.Integer(1), family = reader.Integer(1), port = reader.Integer(2);
  if (mode > 1 || plan.identity.generation < 1 || plan.identity.generation > 3
    || (plan.identity.generation == 2) != (mode == 1)
    || (mode == 0 && (family != 0 || port != 0)) || (mode == 1 && (port == 0 || (family != 4 && family != 6))))
    throw std::invalid_argument("profile");
  plan.denyAll = mode == 0; plan.endpoint.port = static_cast<unsigned short>(port);
  plan.endpoint.family = family == 6 ? CourseforgeNetwork::Endpoint::Family::V6 : CourseforgeNetwork::Endpoint::Family::V4;
  const auto sidBytes = reader.Integer(2);
  if (sidBytes == 0 || sidBytes > 90) throw std::invalid_argument("sid");
  for (size_t index = 0; index < sidBytes; ++index) {
    const auto character = reader.Integer(1);
    if (character == 0 || character > 127) throw std::invalid_argument("sid");
    plan.identity.packageSid.push_back(static_cast<wchar_t>(character));
  }
  const auto keys = reader.Integer(2);
  if (keys != (plan.denyAll ? 4u : 9u)) throw std::invalid_argument("keys");
  plan.filterKeys.resize(static_cast<size_t>(keys));
  for (auto& key : plan.filterKeys) reader.Copy(&key, sizeof(GUID));
  reader.End(); return plan;
}
}

// C ABI carries bounded bytes only, not pointer-bearing SDK structs from JSON/managed code.
// Export lookup is explicit; loading this DLL does not call any policy operation.
extern "C" __declspec(dllexport) UINT32 __stdcall CfnInvoke(UINT32 operation,
  const unsigned char* previous, UINT32 previousBytes, const unsigned char* next, UINT32 nextBytes) noexcept {
  try {
    if (operation < 1 || operation > 3 || (operation != 2 && (previous != nullptr || previousBytes != 0))) return 2;
    const auto desired = Decode(next, nextBytes);
    const auto result = operation == 1 ? CourseforgeNetwork::InstallInitialDenyAll(desired)
      : operation == 2 ? CourseforgeNetwork::ReplaceOwnedPolicy(Decode(previous, previousBytes), desired)
      : CourseforgeNetwork::ReadOwnedPolicy(desired);
    return result == CourseforgeNetwork::PolicyResult::Matched ? 0u : 2u;
  } catch (...) { return 2; }
}

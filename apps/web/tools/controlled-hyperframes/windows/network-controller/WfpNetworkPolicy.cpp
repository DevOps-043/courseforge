#include <initguid.h>
#include "WfpNetworkPolicy.h"
#include <sddl.h>
#include <algorithm>
#include <climits>
#include <cstring>
#include <memory>
#include <regex>
#include <stdexcept>

namespace CourseforgeNetwork {
namespace {
constexpr unsigned int TransactionWaitMilliseconds = 15000;
constexpr unsigned long long MaximumGeneration = 9007199254740991ULL;
const GUID* const Layers[] = {&FWPM_LAYER_ALE_AUTH_CONNECT_V4, &FWPM_LAYER_ALE_AUTH_CONNECT_V6,
  &FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4, &FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6};
struct Rejected {};
void Require(bool valid) { if (!valid) throw Rejected{}; }
bool SameGuid(const GUID& left, const GUID& right) { return !!IsEqualGUID(left, right); }
struct LocalDeleter { void operator()(void* pointer) const { if (pointer) LocalFree(pointer); } };
using LocalMemory = std::unique_ptr<void, LocalDeleter>;
template<class T> struct BfeMemory {
  T* value = nullptr;
  ~BfeMemory() { if (value) FwpmFreeMemory0(reinterpret_cast<void**>(&value)); }
};
struct Engine {
  HANDLE value = nullptr;
  Engine() {
    FWPM_SESSION0 session{}; session.txnWaitTimeoutInMSec = TransactionWaitMilliseconds;
    // flags=0: closing the engine must NOT remove the persistent execution filters.
    Require(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, &session, &value) == ERROR_SUCCESS);
  }
  ~Engine() { if (value) FwpmEngineClose0(value); }
};
struct Transaction {
  HANDLE engine; bool open = true;
  explicit Transaction(HANDLE handle) : engine(handle) { Require(FwpmTransactionBegin0(engine, 0) == ERROR_SUCCESS); }
  void Commit() { Require(FwpmTransactionCommit0(engine) == ERROR_SUCCESS); open = false; }
  ~Transaction() { if (open) FwpmTransactionAbort0(engine); }
};
struct Metadata { GUID lease; unsigned long long generation; std::array<unsigned char, 32> digest; };
static_assert(sizeof(Metadata) == 56, "Unexpected policy metadata layout");
struct Rule {
  GUID layer;
  std::vector<FWPM_FILTER_CONDITION0> conditions;
};
struct CompiledPlan {
  LocalMemory sid;
  FWP_BYTE_ARRAY16 ipv6{};
  Metadata metadata{};
  std::vector<Rule> rules;
  // Pointer-bearing conditions are constructed only after this object reaches its final address.
  explicit CompiledPlan(const PolicyPlan& plan) {
    const auto& id = plan.identity;
    Require(!SameGuid(id.provider, GUID_NULL) && !SameGuid(id.sublayer, GUID_NULL)
      && !SameGuid(id.lease, GUID_NULL) && id.generation > 0 && id.generation <= MaximumGeneration);
    Require(id.packageSid.size() <= 90 && std::regex_match(id.packageSid,
      std::wregex(L"S-1-15-2(-(?:0|[1-9][0-9]{0,9})){7}")));
    PSID parsedSid = nullptr;
    Require(ConvertStringSidToSidW(id.packageSid.c_str(), &parsedSid) != FALSE);
    sid.reset(parsedSid);
    const SID_IDENTIFIER_AUTHORITY authority = {{0,0,0,0,0,15}};
    Require(IsValidSid(parsedSid) && *GetSidSubAuthorityCount(parsedSid) == 8
      && std::memcmp(GetSidIdentifierAuthority(parsedSid), &authority, sizeof(authority)) == 0
      && *GetSidSubAuthority(parsedSid, 0) == 2);
    Require(plan.filterKeys.size() == (plan.denyAll ? 4u : 9u));
    for (size_t index = 0; index < plan.filterKeys.size(); ++index) {
      Require(!SameGuid(plan.filterKeys[index], GUID_NULL));
      for (size_t prior = 0; prior < index; ++prior) Require(!SameGuid(plan.filterKeys[prior], plan.filterKeys[index]));
    }
    Require(plan.denyAll || (plan.endpoint.port != 0 &&
      (plan.endpoint.family == Endpoint::Family::V4 || plan.endpoint.family == Endpoint::Family::V6)));
    metadata = {id.lease, id.generation, id.planDigest}; ipv6.byteArray16[15] = 1;
    for (size_t layer = 0; layer < 4; ++layer) {
      const bool outbound = layer < 2, v6 = (layer % 2) != 0;
      const auto package = PackageCondition();
      if (plan.denyAll || v6 != (plan.endpoint.family == Endpoint::Family::V6)) {
        rules.push_back({*Layers[layer], {package}}); continue;
      }
      Add(layer, package, Scalar(FWPM_CONDITION_IP_PROTOCOL, FWP_UINT8, 6));
      Add(layer, package, Address(outbound ? FWPM_CONDITION_IP_REMOTE_ADDRESS : FWPM_CONDITION_IP_LOCAL_ADDRESS, v6));
      Add(layer, package, Scalar(outbound ? FWPM_CONDITION_IP_REMOTE_PORT : FWPM_CONDITION_IP_LOCAL_PORT,
        FWP_UINT16, plan.endpoint.port));
      if (!outbound) Add(layer, package, Address(FWPM_CONDITION_IP_REMOTE_ADDRESS, v6));
    }
    Require(rules.size() == plan.filterKeys.size());
  }
  CompiledPlan(const CompiledPlan&) = delete;
  CompiledPlan& operator=(const CompiledPlan&) = delete;
  FWPM_FILTER_CONDITION0 PackageCondition() const {
    FWPM_FILTER_CONDITION0 condition{}; condition.fieldKey = FWPM_CONDITION_ALE_PACKAGE_ID;
    condition.matchType = FWP_MATCH_EQUAL; condition.conditionValue.type = FWP_SID;
    condition.conditionValue.sid = static_cast<SID*>(sid.get()); return condition;
  }
  static FWPM_FILTER_CONDITION0 Scalar(const GUID& field, FWP_DATA_TYPE type, unsigned short value) {
    FWPM_FILTER_CONDITION0 condition{}; condition.fieldKey = field;
    condition.matchType = FWP_MATCH_NOT_EQUAL; condition.conditionValue.type = type;
    if (type == FWP_UINT8) condition.conditionValue.uint8 = static_cast<UINT8>(value);
    else condition.conditionValue.uint16 = value;
    return condition;
  }
  FWPM_FILTER_CONDITION0 Address(const GUID& field, bool v6) {
    FWPM_FILTER_CONDITION0 condition{}; condition.fieldKey = field; condition.matchType = FWP_MATCH_NOT_EQUAL;
    if (v6) { condition.conditionValue.type = FWP_BYTE_ARRAY16_TYPE; condition.conditionValue.byteArray16 = &ipv6; }
    else { condition.conditionValue.type = FWP_UINT32; condition.conditionValue.uint32 = 0x7f000001; }
    return condition;
  }
  void Add(size_t layer, FWPM_FILTER_CONDITION0 package, FWPM_FILTER_CONDITION0 excluded) {
    // Distinct filters implement OR of forbidden predicates; conditions within a filter are AND.
    rules.push_back({*Layers[layer], {package, excluded}});
  }
};

void VerifyProvisionedObjects(HANDLE engine, const PolicyIdentity& identity) {
  BfeMemory<FWPM_PROVIDER0> provider;
  Require(FwpmProviderGetByKey0(engine, &identity.provider, &provider.value) == ERROR_SUCCESS);
  Require((provider.value->flags & FWPM_PROVIDER_FLAG_PERSISTENT) != 0
    && (provider.value->flags & FWPM_PROVIDER_FLAG_DISABLED) == 0
    && (!provider.value->serviceName || provider.value->serviceName[0] == L'\0'));
  BfeMemory<FWPM_SUBLAYER0> sublayer;
  Require(FwpmSubLayerGetByKey0(engine, &identity.sublayer, &sublayer.value) == ERROR_SUCCESS);
  Require((sublayer.value->flags & FWPM_SUBLAYER_FLAG_PERSISTENT) != 0 && sublayer.value->providerKey
    && SameGuid(*sublayer.value->providerKey, identity.provider));
}
bool SameCondition(const FWPM_FILTER_CONDITION0& expected, const FWPM_FILTER_CONDITION0& actual) {
  if (!SameGuid(expected.fieldKey, actual.fieldKey) || expected.matchType != actual.matchType
    || expected.conditionValue.type != actual.conditionValue.type) return false;
  const auto& left = expected.conditionValue; const auto& right = actual.conditionValue;
  switch (left.type) {
    case FWP_SID: return right.sid && IsValidSid(right.sid) && EqualSid(left.sid, right.sid);
    case FWP_UINT8: return left.uint8 == right.uint8;
    case FWP_UINT16: return left.uint16 == right.uint16;
    case FWP_UINT32: return left.uint32 == right.uint32;
    case FWP_BYTE_ARRAY16_TYPE: return right.byteArray16 &&
      std::memcmp(left.byteArray16, right.byteArray16, sizeof(FWP_BYTE_ARRAY16)) == 0;
    default: return false;
  }
}
void ReadExact(HANDLE engine, const PolicyPlan& plan, const CompiledPlan& compiled) {
  VerifyProvisionedObjects(engine, plan.identity);
  for (size_t index = 0; index < compiled.rules.size(); ++index) {
    BfeMemory<FWPM_FILTER0> filter;
    Require(FwpmFilterGetByKey0(engine, &plan.filterKeys[index], &filter.value) == ERROR_SUCCESS);
    const auto& observed = *filter.value; const auto& rule = compiled.rules[index];
    Require(observed.providerKey && SameGuid(*observed.providerKey, plan.identity.provider)
      && SameGuid(observed.subLayerKey, plan.identity.sublayer) && SameGuid(observed.layerKey, rule.layer)
      && observed.flags == FWPM_FILTER_FLAG_PERSISTENT && observed.action.type == FWP_ACTION_BLOCK
      && observed.numFilterConditions == rule.conditions.size() && observed.filterCondition
      && observed.providerData.size == sizeof(Metadata) && observed.providerData.data
      && std::memcmp(observed.providerData.data, &compiled.metadata, sizeof(Metadata)) == 0);
    for (size_t condition = 0; condition < rule.conditions.size(); ++condition)
      Require(SameCondition(rule.conditions[condition], observed.filterCondition[condition]));
  }
}
void AddExact(HANDLE engine, const PolicyPlan& plan, CompiledPlan& compiled) {
  for (size_t index = 0; index < compiled.rules.size(); ++index) {
    auto& rule = compiled.rules[index]; FWPM_FILTER0 filter{};
    filter.filterKey = plan.filterKeys[index];
    wchar_t name[] = L"Courseforge execution network boundary"; filter.displayData.name = name;
    filter.flags = FWPM_FILTER_FLAG_PERSISTENT;
    filter.providerKey = const_cast<GUID*>(&plan.identity.provider);
    filter.providerData.size = static_cast<UINT32>(sizeof(Metadata)); filter.providerData.data = reinterpret_cast<UINT8*>(&compiled.metadata);
    filter.layerKey = rule.layer; filter.subLayerKey = plan.identity.sublayer;
    filter.weight.type = FWP_EMPTY; filter.action.type = FWP_ACTION_BLOCK;
    filter.numFilterConditions = static_cast<UINT32>(rule.conditions.size()); filter.filterCondition = rule.conditions.data();
    UINT64 id = 0; Require(FwpmFilterAdd0(engine, &filter, nullptr, &id) == ERROR_SUCCESS);
  }
}
}

PolicyResult InstallInitialDenyAll(const PolicyPlan& plan) noexcept {
  try {
    Require(plan.denyAll && plan.identity.generation == 1); CompiledPlan compiled(plan);
    Engine engine; Transaction transaction(engine.value); VerifyProvisionedObjects(engine.value, plan.identity);
    AddExact(engine.value, plan, compiled); ReadExact(engine.value, plan, compiled); transaction.Commit();
    ReadExact(engine.value, plan, compiled); return PolicyResult::Matched;
  } catch (...) { return PolicyResult::RecoveryRequired; }
}
PolicyResult ReplaceOwnedPolicy(const PolicyPlan& previous, const PolicyPlan& next) noexcept {
  try {
    Require(SameGuid(previous.identity.provider, next.identity.provider) && SameGuid(previous.identity.sublayer, next.identity.sublayer)
      && SameGuid(previous.identity.lease, next.identity.lease) && previous.identity.packageSid == next.identity.packageSid
      && previous.identity.generation < ULLONG_MAX && next.identity.generation == previous.identity.generation + 1);
    CompiledPlan oldCompiled(previous), newCompiled(next); Engine engine; Transaction transaction(engine.value);
    ReadExact(engine.value, previous, oldCompiled);
    AddExact(engine.value, next, newCompiled);
    // Never remove arbitrary keys, foreign filters, or the old policy outside this transaction.
    for (const auto& key : previous.filterKeys) Require(FwpmFilterDeleteByKey0(engine.value, &key) == ERROR_SUCCESS);
    ReadExact(engine.value, next, newCompiled); transaction.Commit();
    ReadExact(engine.value, next, newCompiled); return PolicyResult::Matched;
  } catch (...) { return PolicyResult::RecoveryRequired; }
}
PolicyResult ReadOwnedPolicy(const PolicyPlan& plan) noexcept {
  try { CompiledPlan compiled(plan); Engine engine; ReadExact(engine.value, plan, compiled); return PolicyResult::Matched; }
  catch (...) { return PolicyResult::RecoveryRequired; }
}
}

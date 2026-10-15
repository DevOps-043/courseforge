import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
const source = await readFile(new URL("./windows/network-controller/AuthenticatedNetworkPipe.cs", import.meta.url), "utf8");
const client = await readFile(new URL("./windows/network-controller/AuthenticatedNetworkPipeClient.cs", import.meta.url), "utf8");
// Structural checks, not authentication of a live pipe or execution of Windows token APIs.
test("pipe server requires protected explicit ACL, first instance, remote rejection and no handle inheritance", () => {
  for (const anchor of ["DuplexOverlappedFirst = 0x40080003", "RejectRemoteClients = 0x00000008",
    'string sddl = "D:P(A;;GA;;;"', ";;0x120183;;;", "attributes.Inherit = false", "if (broker.Equals(account)) throw Failure()"])
    assert.ok(source.includes(anchor), anchor);
  assert.doesNotMatch(source, /ImpersonateNamedPipeClient|CreateService|FwpmFilter/);
});
test("peer authentication precedes payload reads and binds process creation, account and logon", () => {
  const firstAuth = source.indexOf("VerifyPeer(pipe, expected, expectedClientPid, expectedClientCreationTime, account, logon);");
  assert.ok(firstAuth > 0 && firstAuth < source.indexOf("var header = await ReadExactlyAsync"));
  for (const anchor of ["actual != expectedPid", "GetProcessTimes(handle", "!= expectedCreationTime",
    "WaitForSingleObject(handle, 0) != Waiting", "identity.User.Equals(account)", "group.Equals(logon)"])
    assert.ok(source.includes(anchor), anchor);
});
test("uncertain dispatch has bounded framing and latches the broker without policy cleanup", () => {
  for (const anchor of ["MaximumPayloadBytes = 32768", "OperationTimeoutMilliseconds = 15000",
    "budget.CancelAfter(OperationTimeoutMilliseconds)", "Task.WhenAny(responseTask, cancelled)",
    "if (!failed || !dispatchStarted) Interlocked.Exchange(ref ActiveChannel, 0)", "new UTF8Encoding(false, true)"])
    assert.ok(source.includes(anchor), anchor);
  assert.doesNotMatch(source, /async void|ActiveChannel, 0[^)]*\)\s*;\s*\/\/.*retry/);
});
test("client verifies the original local server before sending bytes and never requests generic write or delegation", () => {
  const verify = client.indexOf("VerifyServer(pipe, expected, expectedServerPid, expectedServerCreationTime, server, logon);");
  assert.ok(verify > 0 && verify < client.indexOf("await pipe.WriteAsync"));
  for (const anchor of ["GetNamedPipeServerProcessId", "actual != expectedPid", "ClientPipeRights = 0x120183",
    "TokenImpersonationLevel.Identification", "HandleInheritability.None", 'new NamedPipeClientStream("."'])
    assert.ok(client.includes(anchor), anchor);
  assert.doesNotMatch(client, /GenericWrite|TokenImpersonationLevel\.(Impersonation|Delegation)|while\s*\(/);
});

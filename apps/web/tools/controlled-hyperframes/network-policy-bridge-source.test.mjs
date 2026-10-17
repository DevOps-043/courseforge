import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
const root = new URL("./windows/network-controller/", import.meta.url);
const native = await readFile(new URL("NetworkPolicyExports.cpp", root), "utf8");
const managed = await readFile(new URL("NetworkPolicyLibrary.cs", root), "utf8");
test("C ABI bounds bytes, validates end and dispatches only three explicit native operations", () => {
  for (const anchor of ["MaximumRecordBytes = 512", "count > size - offset", "offset != size", "operation < 1 || operation > 3",
    "InstallInitialDenyAll(desired)", "ReplaceOwnedPolicy(Decode(previous, previousBytes), desired)", "ReadOwnedPolicy(desired)"])
    assert.ok(native.includes(anchor), anchor);
  assert.match(native, /extern "C" __declspec\(dllexport\) UINT32 __stdcall CfnInvoke/);
  assert.doesNotMatch(native, /\bDllMain\s*\(|\bmain\s*\(/);
});
test("managed loader requires absolute pinned DLL and restricts dependency search without implicit import", () => {
  for (const anchor of ["Path.IsPathFullyQualified(path)", "actual != expectedSha256", "file.Length != expectedBytes",
    "FileShare.Read", "FileAttributes.ReparsePoint", "LoadLibraryExW(path, IntPtr.Zero, 0x00000800)", 'GetProcAddress(handle, "CfnInvoke")'])
    assert.ok(managed.includes(anchor), anchor);
  assert.doesNotMatch(managed, /DllImport\("courseforge|SetDllDirectory|LoadLibrary\(/);
});

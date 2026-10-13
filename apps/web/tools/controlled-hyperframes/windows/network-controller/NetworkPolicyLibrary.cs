using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Courseforge.ControlledNetwork {
  // Explicit operator load only. No static DLL import, PATH search, install or filter activation.
  public sealed class NetworkPolicyLibrary : IDisposable {
    private sealed class LibraryHandle : SafeHandleZeroOrMinusOneIsInvalid {
      public LibraryHandle() : base(true) {}
      protected override bool ReleaseHandle() { return FreeLibrary(handle); }
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern LibraryHandle LoadLibraryExW(string path, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)] private static extern IntPtr GetProcAddress(LibraryHandle library, string name);
    [DllImport("kernel32.dll")] private static extern bool FreeLibrary(IntPtr library);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint InvokePolicy(uint operation,
      [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] byte[] previous, uint previousBytes,
      [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 4)] byte[] next, uint nextBytes);
    private readonly FileStream pinnedFile;
    private readonly LibraryHandle library;
    private readonly InvokePolicy invoke;
    private readonly object gate = new object();
    private bool disposed;
    private static Exception Failure() { return new InvalidOperationException("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED"); }
    private NetworkPolicyLibrary(FileStream file, LibraryHandle handle, InvokePolicy entry) { pinnedFile = file; library = handle; invoke = entry; }

    public static NetworkPolicyLibrary LoadApproved(string path, string expectedSha256, long expectedBytes, CancellationToken signal) {
      FileStream file = null; LibraryHandle handle = null;
      try {
        signal.ThrowIfCancellationRequested();
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows) || RuntimeInformation.ProcessArchitecture != Architecture.X64
          || path == null || !Path.IsPathFullyQualified(path) || Path.GetFullPath(path) != path
          || !String.Equals(Path.GetExtension(path), ".dll", StringComparison.OrdinalIgnoreCase)
          || expectedBytes < 1 || expectedBytes > 32 * 1024 * 1024
          || expectedSha256 == null || !System.Text.RegularExpressions.Regex.IsMatch(expectedSha256, @"\A[a-f0-9]{64}\z")) throw Failure();
        var candidate = new FileInfo(path);
        if ((candidate.Attributes & FileAttributes.ReparsePoint) != 0) throw Failure();
        var parent = candidate.Directory; int depth = 0;
        while (parent != null) {
          if (++depth > 64 || (parent.Attributes & FileAttributes.ReparsePoint) != 0) throw Failure(); parent = parent.Parent;
        }
        // Keep this non-write/non-delete-shared handle until unload, not just until hashing ends.
        file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length != expectedBytes) throw Failure();
        using (var hash = SHA256.Create()) {
          var actual = BitConverter.ToString(hash.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
          if (actual != expectedSha256 || file.Length != expectedBytes) throw Failure();
        }
        signal.ThrowIfCancellationRequested();
        // Primary path is absolute; dependencies are restricted to System32, never PATH/CWD.
        handle = LoadLibraryExW(path, IntPtr.Zero, 0x00000800);
        if (handle.IsInvalid) throw Failure();
        var address = GetProcAddress(handle, "CfnInvoke"); if (address == IntPtr.Zero) throw Failure();
        signal.ThrowIfCancellationRequested();
        var entry = (InvokePolicy)Marshal.GetDelegateForFunctionPointer(address, typeof(InvokePolicy));
        return new NetworkPolicyLibrary(file, handle, entry);
      } catch {if (handle != null) handle.Dispose(); if (file != null) file.Dispose(); throw Failure();}
    }

    public static void ValidateRecordEnvelope(byte[] record) {
      if (record == null || record.Length < 100 || record.Length > 512) throw Failure();
      if (record[0] != 1 || record[1] != 0 || record[2] != 0 || record[3] != 0) throw Failure();
    }
    public void Apply(uint operation, byte[] previous, byte[] next, CancellationToken signal) {
      lock (gate) {
        if (disposed || operation < 1 || operation > 3) throw Failure();
        ValidateRecordEnvelope(next);
        if (operation == 2) ValidateRecordEnvelope(previous); else if (previous != null) throw Failure();
        signal.ThrowIfCancellationRequested();
        var oldBytes = previous == null ? null : (byte[])previous.Clone(); var newBytes = (byte[])next.Clone();
        // Synchronous native outcome can be uncertain; enclosing broker owns deadline/quarantine.
        uint result = invoke(operation, oldBytes, (uint)(oldBytes == null ? 0 : oldBytes.Length), newBytes, (uint)newBytes.Length);
        signal.ThrowIfCancellationRequested(); if (result != 0) throw Failure();
      }
    }
    public void Dispose() {
      lock (gate) {if (disposed) return; disposed = true; library.Dispose(); pinnedFile.Dispose();}
      // Unloading never deletes persistent filters or the journal reservation.
    }
  }
}

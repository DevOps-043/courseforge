using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Courseforge.ControlledRender {
  public sealed partial class OwnedRenderJob {
    private const uint ExtendedStartup = 0x00080000;
    private const uint TokenDuplicateAndQuery = 0x000A;
    private const int TokenIntegrityLevelClass = 25, TokenIsAppContainerClass = 29, TokenCapabilitiesClass = 30, TokenAppContainerSidClass = 31;
    private const string LowIntegritySid = "S-1-16-4096";
    [StructLayout(LayoutKind.Sequential)] private struct StartupExtended { public Startup StartupInfo; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityCapabilities {
      public IntPtr PackageSid, Capabilities; public uint Count, Reserved;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(
      IntPtr list, int count, uint flags, ref UIntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(
      IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("advapi32.dll", EntryPoint = "CreateProcessAsUserW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateAppContainerAsUser(TokenHandle token, string application, StringBuilder command,
      IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment,
      string directory, ref StartupExtended startup, out ProcessInformation information);

    private static void ValidateAppContainerSid(string sid) {
      if (sid == null || !System.Text.RegularExpressions.Regex.IsMatch(sid, @"\AS-1-15-2(?:-(?:0|[1-9][0-9]{0,9})){7}\z"))
        throw Failure("APPCONTAINER_SID_INVALID");
      foreach (var part in sid.Substring(9).Split('-')) {
        uint component; if (!UInt32.TryParse(part, out component)) throw Failure("APPCONTAINER_SID_INVALID");
      }
    }

    /** Operator-provisioned profile/ACL/loopback only. No profile creation or network capability. */
    public static OwnedRenderJob StartInAppContainer(string executable, string[] arguments, string directory,
      IDictionary<string, string> environment, uint maximumProcesses, ulong processMemoryBytes, ulong jobMemoryBytes,
      uint userCpuSeconds, uint cpuRatePercent, string desktop, string appContainerSid,
      string[] readOnlyPaths, string[] deniedPaths, uint maximumEntries, uint maximumDepth, uint timeoutMilliseconds) {
      ValidateAppContainerSid(appContainerSid);
      if (readOnlyPaths == null || deniedPaths == null || cpuRatePercent < 1 || cpuRatePercent > 100
        || desktop == null || !System.Text.RegularExpressions.Regex.IsMatch(desktop, @"\A[a-zA-Z0-9_-]{1,80}\\[a-zA-Z0-9_-]{1,80}\z")
        || String.Equals(desktop.Substring(desktop.IndexOf('\\') + 1), "default", StringComparison.OrdinalIgnoreCase))
        throw Failure("APPCONTAINER_POLICY_INVALID");
      return StartCore(executable, arguments, directory, environment, maximumProcesses, processMemoryBytes, jobMemoryBytes,
        userCpuSeconds, cpuRatePercent, desktop, null, readOnlyPaths, deniedPaths,
        new AclTreeAudit(maximumEntries, maximumDepth, timeoutMilliseconds), appContainerSid);
    }

    private static ProcessInformation CreateAppContainerChild(TokenHandle reduced, string executable,
      StringBuilder command, string directory, IntPtr environment, Startup startup, string appContainerSid) {
      ValidateAppContainerSid(appContainerSid);
      if (Marshal.SizeOf(typeof(StartupExtended)) != 112 || Marshal.SizeOf(typeof(SecurityCapabilities)) != 24)
        throw Failure("APPCONTAINER_ABI_INVALID");
      IntPtr sid = IntPtr.Zero, attributes = IntPtr.Zero, capabilities = IntPtr.Zero;
      bool initialized = false;
      try {
        if (!ConvertStringSidToSid(appContainerSid, out sid) || !IsValidSid(sid)) throw Failure("APPCONTAINER_SID_INVALID");
        UIntPtr bytes = UIntPtr.Zero;
        if (InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref bytes) || Marshal.GetLastWin32Error() != 122
          || bytes.ToUInt64() == 0 || bytes.ToUInt64() > 65536) throw Failure("APPCONTAINER_ATTRIBUTE_SIZE_FAILED");
        attributes = Marshal.AllocHGlobal((int)bytes.ToUInt64());
        if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref bytes)) throw Failure("APPCONTAINER_ATTRIBUTE_CREATE_FAILED");
        initialized = true;
        var security = new SecurityCapabilities(); security.PackageSid = sid;
        // Count=0, null capabilities: internetClient/privateNetwork/etc cannot be requested by a document.
        capabilities = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecurityCapabilities)));
        Marshal.StructureToPtr(security, capabilities, false);
        if (!UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x00020009), capabilities,
          new UIntPtr((uint)Marshal.SizeOf(typeof(SecurityCapabilities))), IntPtr.Zero, IntPtr.Zero))
          throw Failure("APPCONTAINER_ATTRIBUTE_CONFIGURE_FAILED");
        var extended = new StartupExtended(); extended.StartupInfo = startup;
        extended.StartupInfo.Size = (uint)Marshal.SizeOf(typeof(StartupExtended)); extended.Attributes = attributes;
        ProcessInformation information;
        if (!CreateAppContainerAsUser(reduced, executable, command, IntPtr.Zero, IntPtr.Zero, false,
          Suspended | UnicodeEnvironment | NoWindow | ExtendedStartup, environment, directory, ref extended, out information))
          throw Failure("APPCONTAINER_PROCESS_CREATE_FAILED");
        return information;
      } finally {
        if (initialized) DeleteProcThreadAttributeList(attributes);
        if (capabilities != IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
        if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
        if (sid != IntPtr.Zero) LocalFree(sid);
      }
    }

    // Inspect the actual suspended child, not merely the requested startup attributes.
    private static void VerifyAppContainerChild(ProcessHandle child, string expectedSid, string directory,
      string executable, string[] readOnlyPaths, string[] deniedPaths, AclTreeAudit audit) {
      TokenHandle token;
      if (!OpenProcessToken(child.DangerousGetHandle(), TokenDuplicateAndQuery, out token))
        throw Failure("APPCONTAINER_TOKEN_OPEN_FAILED");
      using (token) {
        if (ReadTokenScalar(token, TokenIsAppContainerClass) != 1 || ReadTokenScalar(token, TokenElevationClass) != 0)
          throw Failure("APPCONTAINER_TOKEN_VERIFY_FAILED");
        const uint MaximumTokenBytes = 65536;
        IntPtr buffer = Marshal.AllocHGlobal((int)MaximumTokenBytes);
        try {
          uint returned;
          if (!GetTokenInformation(token, TokenCapabilitiesClass, buffer, MaximumTokenBytes, out returned)
            || returned < 4 || returned > MaximumTokenBytes || Marshal.ReadInt32(buffer) != 0)
            throw Failure("APPCONTAINER_CAPABILITIES_NOT_EMPTY");
        } finally {Marshal.FreeHGlobal(buffer);}
        VerifyAppContainerTokenSid(token, TokenAppContainerSidClass, IntPtr.Size, expectedSid);
        VerifyAppContainerTokenSid(token, TokenIntegrityLevelClass, Marshal.SizeOf(typeof(SidAndAttributes)), LowIntegritySid);
        VerifyFileAccessPreflight(token, directory, executable, readOnlyPaths, deniedPaths, audit);
      }
    }

    private static void VerifyAppContainerTokenSid(TokenHandle token, int kind, int headerBytes, string expectedSid) {
      const uint MaximumTokenBytes = 65536;
      IntPtr buffer = Marshal.AllocHGlobal((int)MaximumTokenBytes), sid = IntPtr.Zero;
      try {
        uint returned;
        if (!GetTokenInformation(token, kind, buffer, MaximumTokenBytes, out returned)
          || returned < headerBytes + 8 || returned > MaximumTokenBytes) throw Failure("APPCONTAINER_SID_VERIFY_FAILED");
        IntPtr actual = Marshal.ReadIntPtr(buffer);
        long offset = actual.ToInt64() - buffer.ToInt64();
        if (offset < headerBytes || offset > returned - 8) throw Failure("APPCONTAINER_SID_VERIFY_FAILED");
        int components = Marshal.ReadByte(actual, 1);
        if (components > 15 || offset + 8 + components * 4 > returned || !IsValidSid(actual)
          || !ConvertStringSidToSid(expectedSid, out sid) || !EqualSid(actual, sid)) throw Failure("APPCONTAINER_SID_VERIFY_FAILED");
      } finally {if (sid != IntPtr.Zero) LocalFree(sid); Marshal.FreeHGlobal(buffer);}
    }
  }
}

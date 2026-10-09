using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Courseforge.ControlledRender {
  // Owned resources and optional privilege reduction; not a filesystem/network sandbox.
  public sealed partial class OwnedRenderJob : IDisposable {
    // Console's synchronized reader may implement ReadLineAsync synchronously.
    // Own an explicit background reader so the supervisor can still observe the root/deadline.
    public static System.Threading.Tasks.Task<string> ReadControlLine(int maximumCharacters) {
      if (maximumCharacters < 1 || maximumCharacters > 65536) throw Failure("CONTROL_LIMIT_INVALID");
      return System.Threading.Tasks.Task.Run(() => {
        var line = new StringBuilder();
        while (true) {
          int next = Console.In.Read();
          if (next < 0) return line.Length == 0 ? null : line.ToString();
          if (next == '\n') return line.ToString().TrimEnd('\r');
          if (line.Length >= maximumCharacters) throw Failure("CONTROL_LIMIT_EXCEEDED");
          line.Append((char)next);
        }
      });
    }
    private const uint Suspended = 0x00000004, UnicodeEnvironment = 0x00000400, NoWindow = 0x08000000;
    private const uint KillOnClose = 0x00002000, ActiveProcessLimit = 0x00000008, JobTimeLimit = 0x00000004;
    private const uint ProcessMemoryLimit = 0x00000100, JobMemoryLimit = 0x00000200;
    private const int CpuRateControlClass = 15;
    private const uint CpuRateEnable = 0x1, CpuRateHardCap = 0x4;
    private const uint TokenAssignDuplicateQuery = 0x000B, DisableMaximumPrivilege = 0x1, LuaToken = 0x4;
    private const int TokenPrivilegesClass = 3, TokenElevationClass = 20, TokenHasRestrictionsClass = 21;
    private const int TokenRestrictedSidsClass = 11;
    private const int ExtendedLimitClass = 9, AccountingClass = 1, CleanupPollMilliseconds = 10;
    private const uint WaitTimeout = 258, WaitFailed = 0xffffffff;
    private JobHandle job;
    private ProcessHandle process;
    public uint ProcessId { get; private set; }

    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits {
      public long ProcessTime, JobTime; public uint Flags;
      public UIntPtr MinimumWorkingSet, MaximumWorkingSet; public uint ActiveProcesses;
      public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] private struct CpuRateControl { public uint Flags, Rate; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits {
      public BasicLimits Basic; public IoCounters Io;
      public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Accounting {
      public long TotalUser, TotalKernel, PeriodUser, PeriodKernel;
      public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup {
      public uint Size; public string Reserved, Desktop, Title;
      public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
      public ushort ShowWindow, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation {
      public IntPtr Process, Thread; public uint ProcessId, ThreadId;
    }
    private sealed class JobHandle : SafeHandleZeroOrMinusOneIsInvalid {
      public JobHandle() : base(true) {}
      protected override bool ReleaseHandle() { return CloseHandle(handle); }
    }
    private sealed class ProcessHandle : SafeHandleZeroOrMinusOneIsInvalid {
      public ProcessHandle(IntPtr value) : base(true) { SetHandle(value); }
      protected override bool ReleaseHandle() { return CloseHandle(handle); }
    }
    private sealed class TokenHandle : SafeHandleZeroOrMinusOneIsInvalid {
      public TokenHandle() : base(true) {}
      protected override bool ReleaseHandle() { return CloseHandle(handle); }
    }
    [StructLayout(LayoutKind.Sequential)] private struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct SingleTokenGroup { public uint Count; public SidAndAttributes Group; }
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool ConvertStringSidToSid(string text, out IntPtr sid);
    [DllImport("advapi32.dll")] private static extern bool IsValidSid(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern bool EqualSid(IntPtr first, IntPtr second);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out TokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool CreateRestrictedToken(TokenHandle existing, uint flags,
      uint disableCount, IntPtr disable, uint deleteCount, IntPtr delete, uint restrictedCount, IntPtr restricted, out TokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(TokenHandle token, int kind, IntPtr buffer, uint size, out uint returned);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool LookupPrivilegeValue(string system, string name, out Luid value);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CreateProcessAsUser(TokenHandle token,
      string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
      uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInformation information);

    private static int ReadTokenScalar(TokenHandle token, int kind) {
      IntPtr buffer = Marshal.AllocHGlobal(4);
      try {
        uint returned;
        if (!GetTokenInformation(token, kind, buffer, 4, out returned) || returned != 4) throw Failure("TOKEN_VERIFY_FAILED");
        return Marshal.ReadInt32(buffer);
      } finally {Marshal.FreeHGlobal(buffer);}
    }
    private static void VerifyRestrictingSid(TokenHandle token, IntPtr expectedSid) {
      const uint MaximumTokenBytes = 65536;
      IntPtr buffer = Marshal.AllocHGlobal((int)MaximumTokenBytes);
      try {
        uint returned;
        int groupOffset = (int)Marshal.OffsetOf(typeof(SingleTokenGroup), "Group");
        if (!GetTokenInformation(token, TokenRestrictedSidsClass, buffer, MaximumTokenBytes, out returned)
          || returned < groupOffset + Marshal.SizeOf(typeof(SidAndAttributes)) || returned > MaximumTokenBytes
          || Marshal.ReadInt32(buffer) != 1) throw Failure("RESTRICTING_SID_VERIFY_FAILED");
        var observed = (SidAndAttributes)Marshal.PtrToStructure(IntPtr.Add(buffer, groupOffset), typeof(SidAndAttributes));
        // Bound the kernel-returned SID pointer before passing it back to an API.
        long offset = observed.Sid.ToInt64() - buffer.ToInt64();
        if (offset < groupOffset + Marshal.SizeOf(typeof(SidAndAttributes)) || offset > returned - 8)
          throw Failure("RESTRICTING_SID_VERIFY_FAILED");
        int subAuthorities = Marshal.ReadByte(observed.Sid, 1);
        if (subAuthorities > 15 || offset + 8 + subAuthorities * 4 > returned
          || !IsValidSid(observed.Sid) || !EqualSid(observed.Sid, expectedSid)) throw Failure("RESTRICTING_SID_VERIFY_FAILED");
      } finally {Marshal.FreeHGlobal(buffer);}
    }
    private static TokenHandle CreateReducedToken(string restrictingSid) {
      IntPtr sid = IntPtr.Zero, sidArray = IntPtr.Zero;
      try {
        if (restrictingSid != null) {
          if (!System.Text.RegularExpressions.Regex.IsMatch(restrictingSid, @"\AS-1-15-3-1024(?:-(?:0|[1-9][0-9]{0,9})){8}\z"))
            throw Failure("RESTRICTING_SID_INVALID");
          foreach (var part in restrictingSid.Substring(14).Split('-')) {
            uint number; if (!UInt32.TryParse(part, out number)) throw Failure("RESTRICTING_SID_INVALID");
          }
          if (!ConvertStringSidToSid(restrictingSid, out sid) || !IsValidSid(sid)) throw Failure("RESTRICTING_SID_INVALID");
          sidArray = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SidAndAttributes)));
          Marshal.StructureToPtr(new SidAndAttributes {Sid = sid, Attributes = 0}, sidArray, false);
        }
        TokenHandle original;
        if (!OpenProcessToken(GetCurrentProcess(), TokenAssignDuplicateQuery, out original)) throw Failure("TOKEN_OPEN_FAILED");
        using (original) {
          TokenHandle reduced;
          // DISABLE_MAX_PRIVILEGE | LUA_TOKEN. Never SANDBOX_INERT; AppLocker remains enforced.
          if (!CreateRestrictedToken(original, DisableMaximumPrivilege | LuaToken, 0, IntPtr.Zero, 0, IntPtr.Zero,
            restrictingSid == null ? 0U : 1U, sidArray, out reduced))
            throw Failure("TOKEN_REDUCE_FAILED");
          try {
            if (ReadTokenScalar(reduced, TokenElevationClass) != 0 || ReadTokenScalar(reduced, TokenHasRestrictionsClass) == 0) throw Failure("TOKEN_VERIFY_FAILED");
            if (restrictingSid != null) VerifyRestrictingSid(reduced, sid);
            const uint MaximumTokenBytes = 65536;
            IntPtr buffer = Marshal.AllocHGlobal((int)MaximumTokenBytes);
            try {
              uint returned;
              if (!GetTokenInformation(reduced, TokenPrivilegesClass, buffer, MaximumTokenBytes, out returned) || returned < 4 || returned > MaximumTokenBytes)
                throw Failure("TOKEN_VERIFY_FAILED");
              int count = Marshal.ReadInt32(buffer);
              if (count < 0 || count > 1 || returned < 4 + count * 12) throw Failure("TOKEN_PRIVILEGES_NOT_REDUCED");
              if (count == 1) {
                Luid traversal;
                if (!LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out traversal)
                  || (uint)Marshal.ReadInt32(buffer, 4) != traversal.Low || Marshal.ReadInt32(buffer, 8) != traversal.High)
                  throw Failure("TOKEN_PRIVILEGES_NOT_REDUCED");
              }
            } finally {Marshal.FreeHGlobal(buffer);}
            return reduced;
          } catch {reduced.Dispose(); throw;}
        }
      } finally {if (sidArray != IntPtr.Zero) Marshal.FreeHGlobal(sidArray); if (sid != IntPtr.Zero) LocalFree(sid);}
    }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern JobHandle CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(JobHandle job, int kind, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(JobHandle job, int kind, ref CpuRateControl limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(JobHandle job, int kind, out CpuRateControl limits, uint length, IntPtr returnedLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(JobHandle job, int kind, out Accounting accounting, uint length, IntPtr returnedLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(JobHandle job, int kind, out ExtendedLimits limits, uint length, IntPtr returnedLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(JobHandle job, int kind, IntPtr buffer, uint length, IntPtr returnedLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(JobHandle job, ProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(JobHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(ProcessHandle process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(ProcessHandle process, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(ProcessHandle process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint rights, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(ProcessHandle process, JobHandle job, out bool inJob);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(ProcessHandle process, uint flags, StringBuilder name, ref uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CreateProcess(
      string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
      uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInformation information);

    private static Exception Failure(string code) { return new InvalidOperationException("CONTROLLED_RENDER_WINDOWS_" + code); }
    private static string Quote(string argument) {
      if (argument == null || argument.IndexOf('\0') >= 0 || argument.Length > 8192) throw Failure("ARGUMENT_INVALID");
      var quoted = new StringBuilder("\""); int slashes = 0;
      foreach (char character in argument) {
        if (character == '\\') { slashes++; continue; }
        if (character == '"') { quoted.Append('\\', slashes * 2 + 1); quoted.Append('"'); }
        else { quoted.Append('\\', slashes); quoted.Append(character); }
        slashes = 0;
      }
      quoted.Append('\\', slashes * 2); quoted.Append('"'); return quoted.ToString();
    }
    private static string EnvironmentBlock(IDictionary<string, string> environment) {
      if (environment == null || environment.Count > 10) throw Failure("ENVIRONMENT_INVALID");
      var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"};
      var ordered = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      foreach (var entry in environment) {
        if (!allowed.Contains(entry.Key) || entry.Value == null || entry.Value.IndexOf('\0') >= 0 || entry.Value.Length > 32768)
          throw Failure("ENVIRONMENT_INVALID");
        if (ordered.ContainsKey(entry.Key)) throw Failure("ENVIRONMENT_INVALID");
        ordered.Add(entry.Key, entry.Value);
      }
      var block = new StringBuilder(); foreach (var entry in ordered) block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
      block.Append('\0'); if (ordered.Count == 0) block.Append('\0'); return block.ToString();
    }
    public static OwnedRenderJob Start(string executable, string[] arguments, string directory,
      IDictionary<string, string> environment, uint maximumProcesses, ulong processMemoryBytes, ulong jobMemoryBytes, uint userCpuSeconds) {
      return StartCore(executable, arguments, directory, environment, maximumProcesses, processMemoryBytes, jobMemoryBytes, userCpuSeconds, 0, null, null, null, null);
    }
    public static OwnedRenderJob StartWithCpuRate(string executable, string[] arguments, string directory,
      IDictionary<string, string> environment, uint maximumProcesses, ulong processMemoryBytes, ulong jobMemoryBytes,
      uint userCpuSeconds, uint cpuRatePercent) {
      if (cpuRatePercent < 1 || cpuRatePercent > 100) throw Failure("CPU_RATE_INVALID");
      return StartCore(executable, arguments, directory, environment, maximumProcesses, processMemoryBytes, jobMemoryBytes, userCpuSeconds, cpuRatePercent, null, null, null, null);
    }
    public static OwnedRenderJob StartReduced(string executable, string[] arguments, string directory,
      IDictionary<string, string> environment, uint maximumProcesses, ulong processMemoryBytes, ulong jobMemoryBytes,
      uint userCpuSeconds, uint cpuRatePercent, string desktop) {
      if (cpuRatePercent < 1 || cpuRatePercent > 100 || desktop == null
        || !System.Text.RegularExpressions.Regex.IsMatch(desktop, @"\A[a-zA-Z0-9_-]{1,80}\\[a-zA-Z0-9_-]{1,80}\z")
        || String.Equals(desktop.Substring(desktop.IndexOf('\\') + 1), "default", StringComparison.OrdinalIgnoreCase))
        throw Failure("REDUCED_TOKEN_POLICY_INVALID");
      return StartCore(executable, arguments, directory, environment, maximumProcesses, processMemoryBytes, jobMemoryBytes, userCpuSeconds, cpuRatePercent, desktop, null, null, null);
    }
    public static OwnedRenderJob StartWithRestrictingSid(string executable, string[] arguments, string directory,
      IDictionary<string, string> environment, uint maximumProcesses, ulong processMemoryBytes, ulong jobMemoryBytes,
      uint userCpuSeconds, uint cpuRatePercent, string desktop, string restrictingSid) {
      if (restrictingSid == null || cpuRatePercent < 1 || cpuRatePercent > 100 || desktop == null
        || !System.Text.RegularExpressions.Regex.IsMatch(desktop, @"\A[a-zA-Z0-9_-]{1,80}\\[a-zA-Z0-9_-]{1,80}\z")
        || String.Equals(desktop.Substring(desktop.IndexOf('\\') + 1), "default", StringComparison.OrdinalIgnoreCase))
        throw Failure("REDUCED_TOKEN_POLICY_INVALID");
      return StartCore(executable, arguments, directory, environment, maximumProcesses, processMemoryBytes, jobMemoryBytes, userCpuSeconds, cpuRatePercent, desktop, restrictingSid, null, null);
    }
    public static OwnedRenderJob StartWithAclPreflight(string executable, string[] arguments, string directory,
      IDictionary<string, string> environment, uint maximumProcesses, ulong processMemoryBytes, ulong jobMemoryBytes,
      uint userCpuSeconds, uint cpuRatePercent, string desktop, string restrictingSid, string[] readOnlyPaths, string[] deniedPaths) {
      if (restrictingSid == null || readOnlyPaths == null || deniedPaths == null || cpuRatePercent < 1 || cpuRatePercent > 100
        || desktop == null || !System.Text.RegularExpressions.Regex.IsMatch(desktop, @"\A[a-zA-Z0-9_-]{1,80}\\[a-zA-Z0-9_-]{1,80}\z")
        || String.Equals(desktop.Substring(desktop.IndexOf('\\') + 1), "default", StringComparison.OrdinalIgnoreCase))
        throw Failure("ACL_PREFLIGHT_POLICY_INVALID");
      return StartCore(executable, arguments, directory, environment, maximumProcesses, processMemoryBytes, jobMemoryBytes,
        userCpuSeconds, cpuRatePercent, desktop, restrictingSid, readOnlyPaths, deniedPaths);
    }
    public static OwnedRenderJob StartWithAclTreePreflight(string executable, string[] arguments, string directory,
      IDictionary<string, string> environment, uint maximumProcesses, ulong processMemoryBytes, ulong jobMemoryBytes,
      uint userCpuSeconds, uint cpuRatePercent, string desktop, string restrictingSid, string[] readOnlyPaths, string[] deniedPaths,
      uint maximumEntries, uint maximumDepth, uint timeoutMilliseconds) {
      if (restrictingSid == null || readOnlyPaths == null || deniedPaths == null || cpuRatePercent < 1 || cpuRatePercent > 100
        || desktop == null || !System.Text.RegularExpressions.Regex.IsMatch(desktop, @"\A[a-zA-Z0-9_-]{1,80}\\[a-zA-Z0-9_-]{1,80}\z")
        || String.Equals(desktop.Substring(desktop.IndexOf('\\') + 1), "default", StringComparison.OrdinalIgnoreCase))
        throw Failure("ACL_PREFLIGHT_POLICY_INVALID");
      return StartCore(executable, arguments, directory, environment, maximumProcesses, processMemoryBytes, jobMemoryBytes,
        userCpuSeconds, cpuRatePercent, desktop, restrictingSid, readOnlyPaths, deniedPaths,
        new AclTreeAudit(maximumEntries, maximumDepth, timeoutMilliseconds));
    }
    private static OwnedRenderJob StartCore(string executable, string[] arguments, string directory,
      IDictionary<string, string> environment, uint maximumProcesses, ulong processMemoryBytes, ulong jobMemoryBytes,
      uint userCpuSeconds, uint cpuRatePercent, string desktop, string restrictingSid, string[] readOnlyPaths, string[] deniedPaths,
      AclTreeAudit treeAudit = null, string appContainerSid = null) {
      if (Environment.OSVersion.Platform != PlatformID.Win32NT || IntPtr.Size != 8) throw Failure("PLATFORM_UNSUPPORTED");
      if (Marshal.SizeOf(typeof(BasicLimits)) != 64 || Marshal.SizeOf(typeof(ExtendedLimits)) != 144
        || Marshal.SizeOf(typeof(Accounting)) != 48 || Marshal.SizeOf(typeof(Startup)) != 104 || Marshal.SizeOf(typeof(CpuRateControl)) != 8)
        throw Failure("ABI_INVALID");
      if (maximumProcesses < 1 || maximumProcesses > 64 || processMemoryBytes < 64UL * 1024 * 1024
        || processMemoryBytes > jobMemoryBytes || jobMemoryBytes > 4UL * 1024 * 1024 * 1024 || userCpuSeconds < 1 || userCpuSeconds > 600)
        throw Failure("LIMIT_INVALID");
      if (executable == null || directory == null || !Path.IsPathRooted(executable) || !Path.IsPathRooted(directory)
        || !File.Exists(executable) || !Directory.Exists(directory) || arguments == null || arguments.Length > 64)
        throw Failure("INPUT_INVALID");
      if (executable.StartsWith("\\\\", StringComparison.Ordinal) || directory.StartsWith("\\\\", StringComparison.Ordinal)
        || !String.Equals(Path.GetFullPath(executable), executable, StringComparison.OrdinalIgnoreCase)
        || !String.Equals(Path.GetFullPath(directory), directory, StringComparison.OrdinalIgnoreCase)) throw Failure("INPUT_INVALID");
      var command = new StringBuilder(Quote(Path.GetFullPath(executable)));
      foreach (var argument in arguments) command.Append(' ').Append(Quote(argument));
      if (command.Length >= 32767) throw Failure("ARGUMENT_INVALID");
      string environmentBlock = EnvironmentBlock(environment);
      if (desktop != null) {
        foreach (var name in new [] {"TEMP", "TMP", "TMPDIR"}) {
          string temporaryDirectory;
          if (!environment.TryGetValue(name, out temporaryDirectory)
            || !String.Equals(temporaryDirectory, directory, StringComparison.OrdinalIgnoreCase))
            throw Failure("OWNED_TEMP_DIRECTORY_REQUIRED");
        }
      }
      var owned = new OwnedRenderJob(); IntPtr environmentPointer = IntPtr.Zero, thread = IntPtr.Zero;
      try {
        // Unnamed, non-inheritable handle; no breakaway flags and no PID-based cleanup.
        owned.job = CreateJobObject(IntPtr.Zero, null); if (owned.job.IsInvalid) throw Failure("JOB_CREATE_FAILED");
        var limits = new ExtendedLimits();
        limits.Basic.Flags = KillOnClose | ActiveProcessLimit | JobTimeLimit | ProcessMemoryLimit | JobMemoryLimit;
        limits.Basic.ActiveProcesses = maximumProcesses; limits.Basic.JobTime = (long)userCpuSeconds * TimeSpan.TicksPerSecond;
        limits.ProcessMemory = new UIntPtr(processMemoryBytes); limits.JobMemory = new UIntPtr(jobMemoryBytes);
        if (!SetInformationJobObject(owned.job, ExtendedLimitClass, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
          throw Failure("LIMIT_CONFIGURE_FAILED");
        ExtendedLimits observedLimits;
        if (!QueryInformationJobObject(owned.job, ExtendedLimitClass, out observedLimits,
          (uint)Marshal.SizeOf(typeof(ExtendedLimits)), IntPtr.Zero)) throw Failure("LIMIT_READBACK_FAILED");
        if (observedLimits.Basic.Flags != limits.Basic.Flags || observedLimits.Basic.ActiveProcesses != maximumProcesses
          || observedLimits.Basic.JobTime != limits.Basic.JobTime
          || observedLimits.ProcessMemory.ToUInt64() != processMemoryBytes || observedLimits.JobMemory.ToUInt64() != jobMemoryBytes)
          throw Failure("LIMIT_READBACK_MISMATCH");
        if (cpuRatePercent != 0) {
          var cpu = new CpuRateControl(); cpu.Flags = CpuRateEnable | CpuRateHardCap; cpu.Rate = cpuRatePercent * 100;
          if (!SetInformationJobObject(owned.job, CpuRateControlClass, ref cpu, (uint)Marshal.SizeOf(typeof(CpuRateControl))))
            throw Failure("CPU_RATE_CONFIGURE_FAILED");
          CpuRateControl observedCpu;
          if (!QueryInformationJobObject(owned.job, CpuRateControlClass, out observedCpu,
            (uint)Marshal.SizeOf(typeof(CpuRateControl)), IntPtr.Zero)) throw Failure("CPU_RATE_READBACK_FAILED");
          if (observedCpu.Flags != cpu.Flags || observedCpu.Rate != cpu.Rate) throw Failure("CPU_RATE_READBACK_MISMATCH");
        }
        environmentPointer = Marshal.StringToHGlobalUni(environmentBlock);
        var startup = new Startup(); startup.Size = (uint)Marshal.SizeOf(typeof(Startup)); ProcessInformation information;
        if (desktop != null) {
          startup.Desktop = desktop;
          using (var reduced = CreateReducedToken(restrictingSid)) {
            if (readOnlyPaths != null && appContainerSid == null) VerifyFileAccessPreflight(reduced, directory, executable, readOnlyPaths, deniedPaths, treeAudit);
            if (appContainerSid != null) information = CreateAppContainerChild(reduced, Path.GetFullPath(executable), command,
              Path.GetFullPath(directory), environmentPointer, startup, appContainerSid);
            else if (!CreateProcessAsUser(reduced, Path.GetFullPath(executable), command, IntPtr.Zero, IntPtr.Zero, false,
              Suspended | UnicodeEnvironment | NoWindow, environmentPointer, Path.GetFullPath(directory), ref startup, out information))
              throw Failure("REDUCED_PROCESS_CREATE_FAILED");
          }
        } else {
          if (!CreateProcess(Path.GetFullPath(executable), command, IntPtr.Zero, IntPtr.Zero, false,
            Suspended | UnicodeEnvironment | NoWindow, environmentPointer, Path.GetFullPath(directory), ref startup, out information))
            throw Failure("PROCESS_CREATE_FAILED");
        }
        owned.process = new ProcessHandle(information.Process); thread = information.Thread; owned.ProcessId = information.ProcessId;
        if (!AssignProcessToJobObject(owned.job, owned.process)) {
          if (!TerminateProcess(owned.process, 1) || WaitForSingleObject(owned.process, 5000) != 0)
            throw Failure("UNASSIGNED_PROCESS_CLEANUP_FAILED");
          throw Failure("JOB_ASSIGN_FAILED");
        }
        if (appContainerSid != null) VerifyAppContainerChild(owned.process, appContainerSid, directory, executable, readOnlyPaths, deniedPaths, treeAudit);
        if (ResumeThread(thread) == UInt32.MaxValue) throw Failure("PROCESS_RESUME_FAILED");
        return owned;
      } catch {owned.Dispose(); throw;}
      finally {if (thread != IntPtr.Zero) CloseHandle(thread); if (environmentPointer != IntPtr.Zero) Marshal.FreeHGlobal(environmentPointer);}
    }
    public bool WaitRoot(uint milliseconds) {
      if (milliseconds > 600000 || process == null || process.IsClosed) throw Failure("WAIT_INVALID");
      uint result = WaitForSingleObject(process, milliseconds);
      if (result == WaitFailed) throw Failure("WAIT_FAILED");
      if (result != 0 && result != WaitTimeout) throw Failure("WAIT_FAILED");
      return result == 0;
    }
    public uint ActiveProcesses() {
      if (job == null || job.IsClosed) throw Failure("JOB_CLOSED");
      Accounting observed;
      if (!QueryInformationJobObject(job, AccountingClass, out observed, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero))
        throw Failure("ACCOUNTING_FAILED");
      return observed.ActiveProcesses;
    }
    public ulong PeakJobCommittedBytes() {
      if (job == null || job.IsClosed) throw Failure("JOB_CLOSED");
      ExtendedLimits observed;
      if (!QueryInformationJobObject(job, ExtendedLimitClass, out observed, (uint)Marshal.SizeOf(typeof(ExtendedLimits)), IntPtr.Zero))
        throw Failure("ACCOUNTING_FAILED");
      return observed.PeakJobMemory.ToUInt64();
    }
    public uint ConfiguredMaximumProcesses() {
      if (job == null || job.IsClosed) throw Failure("JOB_CLOSED");
      ExtendedLimits observed;
      if (!QueryInformationJobObject(job, ExtendedLimitClass, out observed, (uint)Marshal.SizeOf(typeof(ExtendedLimits)), IntPtr.Zero))
        throw Failure("ACCOUNTING_FAILED");
      if ((observed.Basic.Flags & ActiveProcessLimit) == 0) throw Failure("PROCESS_LIMIT_NOT_CONFIGURED");
      return observed.Basic.ActiveProcesses;
    }
    // Diagnostic snapshot: accounting counters can include members transitioning out.
    // IDs are used only to acquire/query handles, never to target termination.
    public uint LiveMembers() {return ReadLiveMembers(null);}
    public IDictionary<string, uint> LiveMemberKinds() {
      var kinds = new Dictionary<string, uint>(StringComparer.OrdinalIgnoreCase);
      ReadLiveMembers(kinds); return kinds;
    }
    private uint ReadLiveMembers(Dictionary<string, uint> kinds) {
      const int MaximumIds = 512, ProcessListClass = 3;
      const uint SynchronizeAndQueryLimited = 0x00101000;
      if (job == null || job.IsClosed) throw Failure("JOB_CLOSED");
      int bytes = 8 + MaximumIds * IntPtr.Size; IntPtr buffer = Marshal.AllocHGlobal(bytes);
      try {
        if (!QueryInformationJobObject(job, ProcessListClass, buffer, (uint)bytes, IntPtr.Zero)) throw Failure("MEMBER_LIST_FAILED");
        int assigned = Marshal.ReadInt32(buffer, 0), count = Marshal.ReadInt32(buffer, 4);
        if (count < 0 || count > MaximumIds || count != assigned) throw Failure("MEMBER_LIST_INVALID");
        var seen = new HashSet<uint>(); uint live = 0;
        for (int index = 0; index < count; index++) {
          long value = Marshal.ReadInt64(buffer, 8 + index * IntPtr.Size);
          if (value <= 0 || value > UInt32.MaxValue) throw Failure("MEMBER_LIST_INVALID");
          uint id = (uint)value; if (!seen.Add(id)) continue;
          IntPtr handle = OpenProcess(SynchronizeAndQueryLimited, false, id);
          if (handle == IntPtr.Zero) {
            if (Marshal.GetLastWin32Error() == 87) continue; // Already exited; not a PID cleanup fallback.
            throw Failure("MEMBER_HANDLE_FAILED");
          }
          using (var member = new ProcessHandle(handle)) {
            bool belongs; if (!IsProcessInJob(member, job, out belongs)) throw Failure("MEMBER_QUERY_FAILED");
            uint state = WaitForSingleObject(member, 0);
            if (state == WaitFailed) throw Failure("MEMBER_QUERY_FAILED");
            if (belongs && state == WaitTimeout) {
              live++;
              if (kinds != null) {
                var name = new StringBuilder(32768); uint length = (uint)name.Capacity;
                if (!QueryFullProcessImageName(member, 0, name, ref length)) throw Failure("MEMBER_QUERY_FAILED");
                string kind = Path.GetFileName(name.ToString());
                if (!kinds.ContainsKey(kind)) kinds[kind] = 0;
                kinds[kind]++;
              }
            }
          }
        }
        return live;
      } finally {Marshal.FreeHGlobal(buffer);}
    }
    public uint RootExitCode() {
      if (!WaitRoot(0)) throw Failure("ROOT_STILL_RUNNING");
      uint exitCode; if (!GetExitCodeProcess(process, out exitCode)) throw Failure("EXIT_CODE_FAILED");
      return exitCode;
    }
    public void StopAndConfirm(uint cleanupMilliseconds) {
      if (cleanupMilliseconds < 1 || cleanupMilliseconds > 5000) throw Failure("WAIT_INVALID");
      if (job == null || job.IsClosed) throw Failure("JOB_CLOSED");
      if (!TerminateJobObject(job, 1)) throw Failure("TERMINATE_FAILED");
      var clock = Stopwatch.StartNew();
      while (ActiveProcesses() != 0) {
        if (clock.ElapsedMilliseconds >= cleanupMilliseconds) throw Failure("TREE_CLEANUP_TIMEOUT");
        Thread.Sleep(CleanupPollMilliseconds);
      }
    }
    public void Dispose() {
      if (job != null) job.Dispose(); // Kernel kill-on-close also applies if supervisor is terminated.
      if (process != null) process.Dispose();
    }
  }
}

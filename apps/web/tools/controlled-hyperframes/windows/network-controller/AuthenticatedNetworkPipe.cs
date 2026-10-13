using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Courseforge.ControlledNetwork {
  // Explicit host invocation only. Compilation never opens a pipe, changes ACLs or invokes WFP.
  public static partial class AuthenticatedNetworkPipe {
    public const int MaximumPayloadBytes = 32768, OperationTimeoutMilliseconds = 15000;
    private const uint QueryAndSynchronize = 0x00101000, TokenQuery = 0x0008, Waiting = 0x00000102;
    private const uint DuplexOverlappedFirst = 0x40080003, RejectRemoteClients = 0x00000008;
    private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);
    private static int ActiveChannel;
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes {
      public uint Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low, High; }
    private sealed class ProcessHandle : SafeHandleZeroOrMinusOneIsInvalid {
      public ProcessHandle() : base(true) {}
      protected override bool ReleaseHandle() { return CloseHandle(handle); }
    }
    private sealed class TokenHandle : SafeHandleZeroOrMinusOneIsInvalid {
      public TokenHandle() : base(true) {}
      protected override bool ReleaseHandle() { return CloseHandle(handle); }
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern ProcessHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(ProcessHandle process, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(ProcessHandle process,
      out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(ProcessHandle process, uint access, out TokenHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
      string descriptor, uint revision, out IntPtr result, out uint bytes);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafePipeHandle CreateNamedPipeW(
      string name, uint openMode, uint pipeMode, uint instances, uint outputBytes, uint inputBytes,
      uint timeout, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);

    private static Exception Failure() { return new InvalidOperationException("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED"); }
    private static SecurityIdentifier AccountSid(string value) {
      if (value == null || value.Length > 184 || value.IndexOfAny(new char[] {';', '(', ')', '\r', '\n', '\0'}) >= 0) throw Failure();
      var sid = new SecurityIdentifier(value);
      // No Everyone, anonymous, capability/package SID, account-domain SID or implicit groups.
      if (sid.Value != value || !(value.StartsWith("S-1-5-21-", StringComparison.Ordinal)
        || value.StartsWith("S-1-5-80-", StringComparison.Ordinal))) throw Failure();
      return sid;
    }
    private static SecurityIdentifier LogonSid(string value) {
      if (value == null || !System.Text.RegularExpressions.Regex.IsMatch(value, @"\AS-1-5-5-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})\z")) throw Failure();
      var sid = new SecurityIdentifier(value); if (sid.Value != value) throw Failure(); return sid;
    }
    private static void VerifyProcess(ProcessHandle handle, ulong expectedCreationTime, SecurityIdentifier account, SecurityIdentifier logon) {
      if (handle == null || handle.IsInvalid || WaitForSingleObject(handle, 0) != Waiting) throw Failure();
      FileTime creation, exit, kernel, user;
      if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user)
        || (((ulong)creation.High << 32) | creation.Low) != expectedCreationTime) throw Failure();
      TokenHandle token;
      if (!OpenProcessToken(handle, TokenQuery, out token)) throw Failure();
      using (token) using (var identity = new WindowsIdentity(token.DangerousGetHandle())) {
        if (identity.User == null || !identity.User.Equals(account) || identity.Groups == null) throw Failure();
        bool found = false;
        foreach (IdentityReference group in identity.Groups) if (group.Equals(logon)) found = true;
        if (!found) throw Failure();
      }
    }
    private static void VerifyPeer(NamedPipeServerStream pipe, ProcessHandle expected, uint expectedPid,
      ulong expectedCreationTime, SecurityIdentifier account, SecurityIdentifier logon) {
      uint actual;
      if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out actual) || actual != expectedPid) throw Failure();
      // Retained process handle and liveness prohibit accepting a recycled numeric PID.
      VerifyProcess(expected, expectedCreationTime, account, logon);
    }

    /** Protected DACL: client logon gets individual read/write rights, NOT create-pipe-instance.
     * The authenticated host process is separately pinned by the operator's launch owner. */
    public static async Task ServeOnceAsync(Guid channelId, uint expectedClientPid, ulong expectedClientCreationTime, string expectedClientSid,
      string expectedClientLogonSid, string expectedBrokerSid,
      Func<byte[], CancellationToken, Task<byte[]>> dispatch, CancellationToken cancellation) {
      if (channelId == Guid.Empty || expectedClientPid == 0 || expectedClientCreationTime == 0 || dispatch == null) throw Failure();
      if (Interlocked.CompareExchange(ref ActiveChannel, 1, 0) != 0) throw Failure();
      bool dispatchStarted = false, failed = false;
      try {
      using (var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
        budget.CancelAfter(OperationTimeoutMilliseconds);
        try {
          var account = AccountSid(expectedClientSid); var logon = LogonSid(expectedClientLogonSid);
          var broker = AccountSid(expectedBrokerSid);
          if (broker.Equals(account)) throw Failure();
          using (var actualBroker = WindowsIdentity.GetCurrent()) {
            if (actualBroker.User == null || !actualBroker.User.Equals(broker)) throw Failure();
          }
          using (var expected = OpenProcess(QueryAndSynchronize, false, expectedClientPid)) {
            VerifyProcess(expected, expectedClientCreationTime, account, logon);
            IntPtr descriptor = IntPtr.Zero; uint descriptorBytes;
            // 0x120183 excludes FILE_APPEND_DATA / FILE_CREATE_PIPE_INSTANCE (0x4).
            string sddl = "D:P(A;;GA;;;" + broker.Value + ")(A;;0x120183;;;" + logon.Value + ")";
            if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out descriptor, out descriptorBytes)) throw Failure();
            SafePipeHandle handle;
            try {
              var attributes = new SecurityAttributes(); attributes.Length = (uint)Marshal.SizeOf(typeof(SecurityAttributes));
              attributes.Descriptor = descriptor; attributes.Inherit = false;
              handle = CreateNamedPipeW("\\\\.\\pipe\\courseforge-network-" + channelId.ToString("N"),
                DuplexOverlappedFirst, RejectRemoteClients, 1, MaximumPayloadBytes, MaximumPayloadBytes,
                OperationTimeoutMilliseconds, ref attributes);
            } finally {if (descriptor != IntPtr.Zero) LocalFree(descriptor);}
            using (handle) {
              if (handle.IsInvalid) throw Failure();
              using (var pipe = new NamedPipeServerStream(PipeDirection.InOut, true, false, handle)) {
                await pipe.WaitForConnectionAsync(budget.Token).ConfigureAwait(false);
                VerifyPeer(pipe, expected, expectedClientPid, expectedClientCreationTime, account, logon);
                var header = await ReadExactlyAsync(pipe, 4, budget.Token).ConfigureAwait(false);
                int length = DecodeLength(header);
                var request = await ReadExactlyAsync(pipe, length, budget.Token).ConfigureAwait(false);
                ValidatePayload(request); VerifyPeer(pipe, expected, expectedClientPid, expectedClientCreationTime, account, logon);
                // A noncooperative dispatcher cannot send a late response after cancellation.
                dispatchStarted = true;
                var responseTask = dispatch(request, budget.Token);
                if (responseTask == null) throw Failure();
                var cancelled = Task.Delay(Timeout.Infinite, budget.Token);
                if (await Task.WhenAny(responseTask, cancelled).ConfigureAwait(false) != responseTask) {
                  _ = ObserveFailure(responseTask); throw Failure();
                }
                var response = await responseTask.ConfigureAwait(false);
                budget.Token.ThrowIfCancellationRequested();
                VerifyPeer(pipe, expected, expectedClientPid, expectedClientCreationTime, account, logon);
                var frame = EncodeFrame(response);
                await pipe.WriteAsync(frame, 0, frame.Length, budget.Token).ConfigureAwait(false);
                await pipe.FlushAsync(budget.Token).ConfigureAwait(false);
                budget.Token.ThrowIfCancellationRequested();
              }
            }
          }
        } catch {failed = true; throw Failure();}
      }
      } finally {
        // An uncertain dispatch/ACK latches this broker process; no automatic channel restart.
        if (!failed || !dispatchStarted) Interlocked.Exchange(ref ActiveChannel, 0);
      }
      // Closing this channel NEVER deletes or releases any network policy or durable lease.
    }
    private static async Task ObserveFailure(Task task) { try {await task.ConfigureAwait(false);} catch {} }
    private static async Task<byte[]> ReadExactlyAsync(Stream pipe, int length, CancellationToken signal) {
      var bytes = new byte[length]; int received = 0;
      while (received < length) {
        int count = await pipe.ReadAsync(bytes, received, length - received, signal).ConfigureAwait(false);
        if (count <= 0) throw Failure(); received += count;
      }
      signal.ThrowIfCancellationRequested(); return bytes;
    }
    public static int DecodeLength(byte[] header) {
      if (header == null || header.Length != 4) throw Failure();
      uint length = (uint)header[0] | ((uint)header[1] << 8) | ((uint)header[2] << 16) | ((uint)header[3] << 24);
      if (length == 0 || length > MaximumPayloadBytes) throw Failure(); return (int)length;
    }
    public static void ValidatePayload(byte[] bytes) {
      if (bytes == null || bytes.Length == 0 || bytes.Length > MaximumPayloadBytes) throw Failure();
      try {if (StrictUtf8.GetString(bytes).IndexOf('\0') >= 0) throw Failure();} catch {throw Failure();}
    }
    public static byte[] EncodeFrame(byte[] payload) {
      ValidatePayload(payload); var frame = new byte[4 + payload.Length]; uint count = (uint)payload.Length;
      for (int index = 0; index < 4; index++) frame[index] = (byte)(count >> (index * 8));
      Buffer.BlockCopy(payload, 0, frame, 4, payload.Length); return frame;
    }
  }
}

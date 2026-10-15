using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Courseforge.ControlledNetwork {
  public static partial class AuthenticatedNetworkPipe {
    [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
    // Entry for the admitted supervisor CLR bridge. Never execute in a spawned helper PID.
    // Check the client's retained identity before AND after the authenticated exchange.
    public static async Task<byte[]> ExchangeBoundOnceAsync(Guid channelId, uint expectedServerPid,
      ulong expectedServerCreationTime, string expectedServerSid, string expectedServerLogonSid,
      uint expectedClientPid, ulong expectedClientCreationTime, string expectedClientSid,
      string expectedClientLogonSid, byte[] request, CancellationToken cancellation) {
      if (expectedClientPid == 0 || expectedClientCreationTime == 0 || expectedClientPid != GetCurrentProcessId()) throw Failure();
      ValidatePayload(request); byte[] captured = (byte[])request.Clone();
      var account = AccountSid(expectedClientSid); var logon = LogonSid(expectedClientLogonSid);
      using (var expected = OpenProcess(QueryAndSynchronize, false, expectedClientPid)) {
        VerifyProcess(expected, expectedClientCreationTime, account, logon);
        var response = await ExchangeOnceAsync(channelId, expectedServerPid, expectedServerCreationTime,
          expectedServerSid, expectedServerLogonSid, expectedClientSid, captured, cancellation).ConfigureAwait(false);
        VerifyProcess(expected, expectedClientCreationTime, account, logon);
        cancellation.ThrowIfCancellationRequested(); return response;
      }
    }
    private const int ClientPipeRights = 0x120183;
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    private static void VerifyServer(NamedPipeClientStream pipe, ProcessHandle expected, uint expectedPid,
      ulong expectedCreationTime, SecurityIdentifier account, SecurityIdentifier logon) {
      uint actual;
      if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out actual) || actual != expectedPid) throw Failure();
      VerifyProcess(expected, expectedCreationTime, account, logon);
    }

    // Operator-bound local endpoint only. No pipe name, server identity or PID learned from a response.
    public static async Task<byte[]> ExchangeOnceAsync(Guid channelId, uint expectedServerPid,
      ulong expectedServerCreationTime, string expectedServerSid, string expectedServerLogonSid,
      string expectedClientSid, byte[] request, CancellationToken cancellation) {
      if (channelId == Guid.Empty || expectedServerPid == 0 || expectedServerCreationTime == 0) throw Failure();
      ValidatePayload(request); var requestFrame = EncodeFrame(request);
      using (var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
        budget.CancelAfter(OperationTimeoutMilliseconds);
        try {
          var server = AccountSid(expectedServerSid); var logon = LogonSid(expectedServerLogonSid);
          var client = AccountSid(expectedClientSid);
          if (server.Equals(client)) throw Failure();
          using (var actualClient = WindowsIdentity.GetCurrent()) {
            if (actualClient.User == null || !actualClient.User.Equals(client)) throw Failure();
          }
          using (var expected = OpenProcess(QueryAndSynchronize, false, expectedServerPid)) {
            VerifyProcess(expected, expectedServerCreationTime, server, logon);
            // Individual access rights avoid FILE_CREATE_PIPE_INSTANCE. Identification forbids
            // the pipe server from receiving an impersonation/delegation token from this client.
            using (var pipe = new NamedPipeClientStream(".", "courseforge-network-" + channelId.ToString("N"),
              (PipeAccessRights)ClientPipeRights, PipeOptions.Asynchronous,
              TokenImpersonationLevel.Identification, HandleInheritability.None)) {
              await pipe.ConnectAsync(budget.Token).ConfigureAwait(false);
              VerifyServer(pipe, expected, expectedServerPid, expectedServerCreationTime, server, logon);
              budget.Token.ThrowIfCancellationRequested();
              await pipe.WriteAsync(requestFrame, 0, requestFrame.Length, budget.Token).ConfigureAwait(false);
              await pipe.FlushAsync(budget.Token).ConfigureAwait(false);
              var header = await ReadExactlyAsync(pipe, 4, budget.Token).ConfigureAwait(false);
              var response = await ReadExactlyAsync(pipe, DecodeLength(header), budget.Token).ConfigureAwait(false);
              ValidatePayload(response);
              VerifyServer(pipe, expected, expectedServerPid, expectedServerCreationTime, server, logon);
              budget.Token.ThrowIfCancellationRequested(); return response;
            }
          }
        } catch {throw Failure();}
      }
      // No resend/reconnect fallback: lost response requires durable reconciliation.
    }
  }
}

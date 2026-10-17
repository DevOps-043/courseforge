using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Courseforge.ControlledNetwork {
  // Precompiled assembly entry for edge.func({assemblyFile, typeName, methodName}).
  // Invoke only captures arguments. Native work begins exclusively through the returned exchange.
  public sealed class NetworkPipeManagedEntry {
    private readonly object gate = new object();
    private bool outstanding;
    private static Exception Failure() {
      return new InvalidOperationException("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED");
    }
    private static string Text(IDictionary<string, object> request, string key) {
      object value;
      if (!request.TryGetValue(key, out value) || !(value is string)) throw Failure();
      return (string)value;
    }
    private static ulong Decimal(IDictionary<string, object> request, string key, ulong maximum) {
      string text = Text(request, key); ulong value;
      // Decimal strings preserve FILETIME and avoid CLR/V8 floating-point truncation.
      if (!Regex.IsMatch(text, @"\A[1-9][0-9]{0,19}\z")
        || !ulong.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value)
        || value > maximum) throw Failure();
      return value;
    }
    private static string Sid(IDictionary<string, object> request, string key, bool logon) {
      string text = Text(request, key);
      string component = @"(?:0|[1-9][0-9]{0,9})";
      string pattern = logon ? @"\AS-1-5-5-" + component + "-" + component + @"\z"
        : @"\AS-1-5-(?:21(?:-" + component + "){4}|80(?:-" + component + @"){5})\z";
      if (text.Length > 184 || !Regex.IsMatch(text, pattern)) throw Failure();
      string[] parts = text.Split('-');
      for (int index = 4; index < parts.Length; index++) {
        uint part; if (!uint.TryParse(parts[index], NumberStyles.None, CultureInfo.InvariantCulture, out part)) throw Failure();
      }
      return text;
    }
    public Task<object> Invoke(object input) {
      var request = input as IDictionary<string, object>;
      string[] fields = {"channelId", "expectedServerPid", "expectedServerCreationFileTime", "expectedServerSid",
        "expectedServerLogonSid", "expectedClientPid", "expectedClientCreationFileTime", "expectedClientSid",
        "expectedClientLogonSid", "payload"};
      if (request == null || request.Count != fields.Length) throw Failure();
      foreach (string field in fields) if (!request.ContainsKey(field)) throw Failure();
      Guid channelId; string channel = Text(request, "channelId");
      if (!Guid.TryParseExact(channel, "D", out channelId) || channelId == Guid.Empty
        || channelId.ToString("D") != channel) throw Failure();
      uint serverPid = (uint)Decimal(request, "expectedServerPid", uint.MaxValue);
      uint clientPid = (uint)Decimal(request, "expectedClientPid", uint.MaxValue);
      ulong serverCreation = Decimal(request, "expectedServerCreationFileTime", ulong.MaxValue);
      ulong clientCreation = Decimal(request, "expectedClientCreationFileTime", ulong.MaxValue);
      string serverSid = Sid(request, "expectedServerSid", false), clientSid = Sid(request, "expectedClientSid", false);
      string serverLogon = Sid(request, "expectedServerLogonSid", true), clientLogon = Sid(request, "expectedClientLogonSid", true);
      var payload = request["payload"] as byte[];
      if (serverPid == clientPid || serverSid == clientSid || serverLogon == clientLogon) throw Failure();
      AuthenticatedNetworkPipe.ValidatePayload(payload);
      byte[] captured = (byte[])payload.Clone();
      lock (gate) {
        if (outstanding) throw Failure();
        outstanding = true;
      }
      var lease = new ExchangeLease(() => {lock (gate) {outstanding = false;}},
        token => AuthenticatedNetworkPipe.ExchangeBoundOnceAsync(channelId, serverPid, serverCreation, serverSid,
          serverLogon, clientPid, clientCreation, clientSid, clientLogon, captured, token));
      return Task.FromResult<object>(new Dictionary<string, object> {
        {"exchange", new Func<object, Task<object>>(lease.Exchange)},
        {"cancel", new Func<object, Task<object>>(lease.Cancel)}
      });
    }
    private sealed class ExchangeLease {
      private readonly object gate = new object();
      private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
      private readonly Func<CancellationToken, Task<byte[]>> exchange;
      private readonly Action release;
      private bool started, finished;
      internal ExchangeLease(Action release, Func<CancellationToken, Task<byte[]>> exchange) {
        this.release = release; this.exchange = exchange;
      }
      internal async Task<object> Exchange(object input) {
        CancellationToken token;
        lock (gate) {
          if (input != null || started || finished) throw Failure();
          started = true; token = cancellation.Token;
        }
        try {
          token.ThrowIfCancellationRequested();
          byte[] response = await exchange(token).ConfigureAwait(false);
          token.ThrowIfCancellationRequested();
          return (byte[])response.Clone();
        } catch {throw Failure();}
        finally {lock (gate) {finished = true; cancellation.Dispose(); release();}}
      }
      internal Task<object> Cancel(object input) {
        lock (gate) {
          if (input != null) throw Failure();
          if (!finished) {
            cancellation.Cancel();
            // A pending exchange owns disposal/release until it actually exits.
            if (!started) {finished = true; cancellation.Dispose(); release();}
          }
        }
        return Task.FromResult<object>(null);
      }
    }
  }
}

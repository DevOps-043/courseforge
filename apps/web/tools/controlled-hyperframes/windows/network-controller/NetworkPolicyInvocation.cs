using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Courseforge.ControlledNetwork {
  public sealed class OwnedFilterObservation {
    public string Scope { get { return "OWNED_FILTERS_MATCH_NOT_EFFECTIVE_NETWORK_POLICY"; } }
    public uint Operation { get; private set; }
    public string RecordSha256 { get; private set; }
    internal OwnedFilterObservation(uint operation, byte[] record) {
      Operation = operation;
      using (var hash = SHA256.Create()) RecordSha256 = BitConverter.ToString(hash.ComputeHash(record)).Replace("-", "").ToLowerInvariant();
    }
  }
  // Concrete managed-to-DLL invocation. No automatic load, default authority or policy activation.
  public static class NetworkPolicyInvocation {
    private static Exception Failure() { return new InvalidOperationException("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED"); }
    private static ushort UInt16(byte[] bytes, int offset) { return (ushort)(bytes[offset] | (bytes[offset + 1] << 8)); }
    private static Guid GuidAt(byte[] bytes, int offset) { var value = new byte[16]; Buffer.BlockCopy(bytes, offset, value, 0, 16); return new Guid(value); }
    private sealed class Record { public Guid Provider, Sublayer, Lease; public ulong Generation; public string Sid; }
    private static Record Decode(byte[] bytes) {
      NetworkPolicyLibrary.ValidateRecordEnvelope(bytes);
      var result = new Record { Provider = GuidAt(bytes, 4), Sublayer = GuidAt(bytes, 20), Lease = GuidAt(bytes, 36) };
      for (int index = 0; index < 8; index++) result.Generation |= (ulong)bytes[52 + index] << (index * 8);
      int mode = bytes[92], family = bytes[93], port = UInt16(bytes, 94), sidLength = UInt16(bytes, 96);
      if (result.Provider == Guid.Empty || result.Sublayer == Guid.Empty || result.Lease == Guid.Empty
        || result.Generation < 1 || result.Generation > 3 || mode > 1 || (result.Generation == 2) != (mode == 1)
        || (mode == 0 && (family != 0 || port != 0)) || (mode == 1 && (port == 0 || (family != 4 && family != 6)))
        || sidLength < 1 || sidLength > 90 || 100 + sidLength > bytes.Length) throw Failure();
      for (int index = 0; index < sidLength; index++) if (bytes[98 + index] == 0 || bytes[98 + index] > 127) throw Failure();
      result.Sid = Encoding.ASCII.GetString(bytes, 98, sidLength);
      if (!System.Text.RegularExpressions.Regex.IsMatch(result.Sid, @"\AS-1-15-2(?:-(?:0|[1-9][0-9]{0,9})){7}\z")) throw Failure();
      foreach (var component in result.Sid.Substring(9).Split('-')) {
        uint parsed; if (!UInt32.TryParse(component, out parsed)) throw Failure();
      }
      int count = UInt16(bytes, 98 + sidLength);
      if (count != (mode == 0 ? 4 : 9) || bytes.Length != 100 + sidLength + count * 16) throw Failure();
      var keys = new System.Collections.Generic.HashSet<Guid>();
      for (int index = 0; index < count; index++) {
        var key = GuidAt(bytes, 100 + sidLength + index * 16);
        if (key == Guid.Empty || !keys.Add(key)) throw Failure();
      }
      return result;
    }
    public static void ValidateOwnedOperation(uint operation, byte[] previous, byte[] next,
      Guid provider, Guid sublayer, Guid lease, string packageSid) {
      if (operation < 1 || operation > 3 || provider == Guid.Empty || sublayer == Guid.Empty || lease == Guid.Empty) throw Failure();
      var desired = Decode(next);
      if (desired.Provider != provider || desired.Sublayer != sublayer || desired.Lease != lease || desired.Sid != packageSid) throw Failure();
      if (operation == 1 && desired.Generation != 1) throw Failure();
      if (operation == 2) {
        var old = Decode(previous);
        if (old.Provider != provider || old.Sublayer != sublayer || old.Lease != lease || old.Sid != packageSid
          || desired.Generation != old.Generation + 1) throw Failure();
      } else if (previous != null) throw Failure();
    }
    public static OwnedFilterObservation Invoke(NetworkPolicyLibrary library, uint operation, byte[] previous, byte[] next,
      Guid approvedProvider, Guid approvedSublayer, Guid approvedLease, string approvedPackageSid, CancellationToken signal) {
      if (library == null) throw Failure();
      // Frozen copies prevent caller mutation between validation and marshalling to native code.
      var oldBytes = previous == null ? null : (byte[])previous.Clone(); var newBytes = next == null ? null : (byte[])next.Clone();
      ValidateOwnedOperation(operation, oldBytes, newBytes, approvedProvider, approvedSublayer, approvedLease, approvedPackageSid);
      signal.ThrowIfCancellationRequested(); library.Apply(operation, oldBytes, newBytes, signal);
      signal.ThrowIfCancellationRequested(); return new OwnedFilterObservation(operation, newBytes);
    }
  }
}

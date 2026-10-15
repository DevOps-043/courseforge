using System;
using System.Collections.Generic;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Courseforge.ControlledRender {
  // Optional bounded subtree audit. No ACL mutation or race-free filesystem sandbox claim.
  public sealed partial class OwnedRenderJob {
    private const uint FileGenericRead = 0x00120089, FileGenericWrite = 0x00120116;
    private const uint FileGenericExecute = 0x001200A0, FileAllAccess = 0x001F01FF;
    private const uint OwnerGroupDacl = 0x7, FileObjectType = 1, PrivilegeBufferBytes = 65536;
    private const uint ReadData = 0x1, WriteData = 0x2, AppendData = 0x4, WriteExtendedAttributes = 0x10;
    private const uint Execute = 0x20, DeleteChild = 0x40, WriteAttributes = 0x100;
    private const uint Delete = 0x10000, WriteDacl = 0x40000, WriteOwner = 0x80000;
    private const int SecurityImpersonationLevel = 2;
    private static readonly uint[] FileModificationRights = {WriteData, AppendData, WriteExtendedAttributes,
      DeleteChild, WriteAttributes, Delete, WriteDacl, WriteOwner};
    private sealed class AclTreeAudit {
      public readonly uint MaximumEntries, MaximumDepth, TimeoutMilliseconds;
      private readonly Stopwatch clock = Stopwatch.StartNew();
      private uint entries;
      private readonly HashSet<string> visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      public AclTreeAudit(uint maximumEntries, uint maximumDepth, uint timeoutMilliseconds) {
        if (maximumEntries < 1 || maximumEntries > 50000 || maximumDepth < 1 || maximumDepth > 64
          || timeoutMilliseconds < 100 || timeoutMilliseconds > 60000) throw Failure("ACL_TREE_LIMIT_INVALID");
        MaximumEntries = maximumEntries; MaximumDepth = maximumDepth; TimeoutMilliseconds = timeoutMilliseconds;
      }
      public void CheckBudget() {
        if (clock.ElapsedMilliseconds >= TimeoutMilliseconds) throw Failure("ACL_TREE_DEADLINE_EXCEEDED");
      }
      public void Visit(string path, uint depth) {
        CheckBudget();
        if (depth > MaximumDepth || entries >= MaximumEntries || !visited.Add(path)) throw Failure("ACL_TREE_LIMIT_EXCEEDED");
        entries++;
      }
      public string[] Enumerate(string directory) {
        CheckBudget();
        var children = new List<string>();
        foreach (var child in Directory.EnumerateFileSystemEntries(directory)) {
          CheckBudget();
          if (children.Count >= MaximumEntries || child.Length > 4096) throw Failure("ACL_TREE_LIMIT_EXCEEDED");
          children.Add(child);
        }
        children.Sort(StringComparer.OrdinalIgnoreCase);
        return children.ToArray();
      }
    }
    private static void AuditAclTree(TokenHandle token, string path, bool readOnly, uint depth, AclTreeAudit audit) {
      audit.Visit(path, depth);
      ValidateAclProbePath(path);
      var attributes = File.GetAttributes(path);
      bool directory = (attributes & FileAttributes.Directory) != 0;
      if (readOnly) {
        AssertFileAccess(token, path, directory ? FileGenericRead | FileGenericExecute : FileGenericRead, true);
      } else {
        AssertFileAccess(token, path, ReadData, false);
        AssertFileAccess(token, path, Execute, false);
      }
      AssertNoModification(token, path);
      audit.CheckBudget();
      if (!directory) return;
      string[] before = audit.Enumerate(path);
      foreach (var child in before) AuditAclTree(token, child, readOnly, depth + 1, audit);
      ValidateAclProbePath(path);
      string[] after = audit.Enumerate(path);
      if (before.Length != after.Length) throw Failure("ACL_TREE_CHANGED");
      for (int index = 0; index < before.Length; index++)
        if (!String.Equals(before[index], after[index], StringComparison.Ordinal)) throw Failure("ACL_TREE_CHANGED");
      audit.CheckBudget();
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileGenericMapping { public uint Read, Write, Execute, All; }
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool DuplicateToken(TokenHandle existing, int level, out TokenHandle impersonation);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern uint GetNamedSecurityInfo(
      string name, uint objectType, uint securityInformation, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool AccessCheck(IntPtr descriptor,
      TokenHandle token, uint desired, ref FileGenericMapping mapping, IntPtr privileges, ref uint privilegeBytes, out uint granted, out bool allowed);

    private static void ValidateAclProbePath(string path) {
      if (path == null || path.Length > 4096 || !Path.IsPathRooted(path) || path.StartsWith("\\\\", StringComparison.Ordinal)
        || !String.Equals(Path.GetFullPath(path), path, StringComparison.OrdinalIgnoreCase)) throw Failure("ACL_PREFLIGHT_PATH_INVALID");
      string current = path;
      while (current != null) {
        if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw Failure("ACL_PREFLIGHT_REPARSE_REJECTED");
        current = Path.GetDirectoryName(current);
      }
    }
    private static void AssertFileAccess(TokenHandle impersonation, string path, uint desired, bool expectedAllowed) {
      IntPtr descriptor = IntPtr.Zero, privileges = IntPtr.Zero;
      try {
        IntPtr owner, group, dacl, sacl;
        if (GetNamedSecurityInfo(path, FileObjectType, OwnerGroupDacl, out owner, out group, out dacl, out sacl, out descriptor) != 0
          || descriptor == IntPtr.Zero) throw Failure("ACL_PREFLIGHT_READ_FAILED");
        var mapping = new FileGenericMapping {Read = FileGenericRead, Write = FileGenericWrite, Execute = FileGenericExecute, All = FileAllAccess};
        privileges = Marshal.AllocHGlobal((int)PrivilegeBufferBytes);
        uint privilegeBytes = PrivilegeBufferBytes, granted; bool allowed;
        // All desired masks below are already specific file rights, with no generic bits.
        if (!AccessCheck(descriptor, impersonation, desired, ref mapping, privileges, ref privilegeBytes, out granted, out allowed)
          || privilegeBytes > PrivilegeBufferBytes) throw Failure("ACL_PREFLIGHT_CHECK_FAILED");
        if (allowed != expectedAllowed || (allowed && (granted & desired) != desired)) throw Failure("ACL_PREFLIGHT_MISMATCH");
      } finally {
        if (privileges != IntPtr.Zero) Marshal.FreeHGlobal(privileges);
        if (descriptor != IntPtr.Zero) LocalFree(descriptor);
      }
    }
    private static void AssertNoModification(TokenHandle token, string path) {
      // Check individual rights: a denied combined mask would not prove each right is denied.
      foreach (uint right in FileModificationRights)
        AssertFileAccess(token, path, right, false);
    }
    private static void VerifyFileAccessPreflight(TokenHandle primary, string directory, string executable, string[] readOnlyPaths, string[] deniedPaths,
      AclTreeAudit treeAudit) {
      if (readOnlyPaths.Length < 1 || readOnlyPaths.Length > 32 || deniedPaths == null || deniedPaths.Length < 1 || deniedPaths.Length > 32)
        throw Failure("ACL_PREFLIGHT_POLICY_INVALID");
      var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      foreach (var path in readOnlyPaths) {ValidateAclProbePath(path); if (!seen.Add(path)) throw Failure("ACL_PREFLIGHT_POLICY_INVALID");}
      foreach (var path in deniedPaths) {ValidateAclProbePath(path); if (!seen.Add(path)) throw Failure("ACL_PREFLIGHT_POLICY_INVALID");}
      ValidateAclProbePath(directory); ValidateAclProbePath(executable);
      TokenHandle impersonation;
      if (!DuplicateToken(primary, SecurityImpersonationLevel, out impersonation)) throw Failure("ACL_PREFLIGHT_TOKEN_FAILED");
      using (impersonation) {
        AssertFileAccess(impersonation, directory, FileGenericRead | FileGenericWrite, true);
        AssertFileAccess(impersonation, executable, FileGenericRead | FileGenericExecute, true);
        AssertNoModification(impersonation, executable);
        foreach (var path in readOnlyPaths) {
          if (treeAudit != null) {AuditAclTree(impersonation, path, true, 0, treeAudit); continue;}
          AssertFileAccess(impersonation, path, FileGenericRead | FileGenericExecute, true);
          AssertNoModification(impersonation, path);
        }
        foreach (var path in deniedPaths) {
          if (treeAudit != null) {AuditAclTree(impersonation, path, false, 0, treeAudit); continue;}
          AssertFileAccess(impersonation, path, ReadData, false);
          AssertFileAccess(impersonation, path, Execute, false);
          AssertNoModification(impersonation, path);
        }
      }
    }
  }
}

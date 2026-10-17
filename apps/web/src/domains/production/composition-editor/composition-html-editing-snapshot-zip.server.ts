import JSZip from "jszip";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";

export const HTML_SNAPSHOT_ZIP_POLICY = Object.freeze({
  maximumArchiveBytes: HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES,
  maximumEntries: 1024, maximumDeclaredBytes: 256 * 1024 * 1024,
  maximumPathBytes: 1024,
});
const ZIP = { end: 0x06054b50, central: 0x02014b50, local: 0x04034b50, descriptor: 0x08074b50,
  endBytes: 22, centralBytes: 46, localBytes: 30, maximumCommentBytes: 65535,
  utf8Flag: 0x0800, descriptorFlag: 0x0008, supportedFlags: 0x080e,
  zip64Extra: 0x0001, unicodePathExtra: 0x7075, aesExtra: 0x9901 } as const;
type Entry = { path: string; bytes: number; directory: boolean; start: number; end: number };

function invalid(): never { throw new Error("HTML_SNAPSHOT_ZIP_INVALID"); }
function range(buffer: Buffer, offset: number, length: number, ceiling = buffer.length) {
  if (offset < 0 || length < 0 || offset + length > ceiling) invalid();
}
function extras(buffer: Buffer, offset: number, length: number) {
  const end = offset + length;
  while (offset < end) {
    range(buffer, offset, 4, end);
    const id = buffer.readUInt16LE(offset), size = buffer.readUInt16LE(offset + 2);
    // These extensions change sizes, encryption or the path interpreted by JSZip.
    if (id === ZIP.zip64Extra || id === ZIP.unicodePathExtra || id === ZIP.aesExtra) invalid();
    offset += 4; range(buffer, offset, size, end); offset += size;
  }
}
function pathName(bytes: Buffer, flags: number): string {
  if (!bytes.length || bytes.length > HTML_SNAPSHOT_ZIP_POLICY.maximumPathBytes) invalid();
  if (!(flags & ZIP.utf8Flag) && bytes.some(byte => byte > 127)) invalid();
  const path = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parts = (path.endsWith("/") ? path.slice(0, -1) : path).split("/");
  if (path !== path.normalize("NFC") || /[\\:\x00-\x1f\x7f]/.test(path)
    || parts.some(part => !part || part === "." || part === "..")) invalid();
  return path;
}
function localRange(buffer: Buffer, central: number, directoryStart: number, name: Buffer,
  flags: number, method: number, crc: number, compressed: number, expanded: number): { start: number; end: number } {
  const start = buffer.readUInt32LE(central + 42);
  range(buffer, start, ZIP.localBytes, directoryStart);
  if (buffer.readUInt32LE(start) !== ZIP.local || buffer.readUInt16LE(start + 4) > 20
    || buffer.readUInt16LE(start + 6) !== flags || buffer.readUInt16LE(start + 8) !== method) invalid();
  const nameBytes = buffer.readUInt16LE(start + 26), extraBytes = buffer.readUInt16LE(start + 28);
  range(buffer, start + ZIP.localBytes, nameBytes + extraBytes, directoryStart);
  if (!buffer.subarray(start + ZIP.localBytes, start + ZIP.localBytes + nameBytes).equals(name)) invalid();
  extras(buffer, start + ZIP.localBytes + nameBytes, extraBytes);
  const localFields = [buffer.readUInt32LE(start + 14), buffer.readUInt32LE(start + 18), buffer.readUInt32LE(start + 22)];
  const centralFields = [crc, compressed, expanded];
  if (localFields.some((value, index) => value !== centralFields[index]
    && (!(flags & ZIP.descriptorFlag) || value !== 0))) invalid();
  let end = start + ZIP.localBytes + nameBytes + extraBytes + compressed;
  range(buffer, start, end - start, directoryStart);
  if (flags & ZIP.descriptorFlag) {
    range(buffer, end, 12, directoryStart);
    // Signature is optional. Resolve CRC/signature ambiguity by matching every field.
    const matches = (at: number) => at + 12 <= directoryStart && centralFields.every((value, index) =>
      buffer.readUInt32LE(at + index * 4) === value);
    if (buffer.readUInt32LE(end) === ZIP.descriptor && matches(end + 4)) end += 16;
    else if (matches(end)) end += 12;
    else invalid();
  }
  return { start, end };
}

/** Narrow, non-extracting ZIP profile. Validate allocation and namespace before
 * JSZip parses anything. No SFX, split/ZIP64, encrypted or aliased-path archives. */
function inspectDirectory(buffer: Buffer, signal?: AbortSignal): Entry[] {
  signal?.throwIfAborted();
  if (buffer.length < ZIP.endBytes || buffer.length > HTML_SNAPSHOT_ZIP_POLICY.maximumArchiveBytes) invalid();
  let end = -1;
  for (let at = buffer.length - ZIP.endBytes;
    at >= Math.max(0, buffer.length - ZIP.endBytes - ZIP.maximumCommentBytes); at--) {
    if (buffer.readUInt32LE(at) === ZIP.end && at + ZIP.endBytes + buffer.readUInt16LE(at + 20) === buffer.length) {
      end = at; break;
    }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) invalid();
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (!count || count > HTML_SNAPSHOT_ZIP_POLICY.maximumEntries || buffer.readUInt16LE(end + 8) !== count
    || start + size !== end) invalid();
  const entries: Entry[] = [], paths = new Set<string>();
  let offset = start, declaredBytes = 0;
  for (let index = 0; index < count; index++) {
    signal?.throwIfAborted(); range(buffer, offset, ZIP.centralBytes, end);
    if (buffer.readUInt32LE(offset) !== ZIP.central || buffer.readUInt16LE(offset + 6) > 20
      || buffer.readUInt16LE(offset + 34)) invalid();
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    if (flags & ~ZIP.supportedFlags || ![0, 8].includes(method) || (method === 0 && (flags & 6))) invalid();
    const compressed = buffer.readUInt32LE(offset + 20), expanded = buffer.readUInt32LE(offset + 24);
    if (compressed === 0xffffffff || expanded === 0xffffffff || (method === 0 && compressed !== expanded)) invalid();
    declaredBytes += expanded;
    if (declaredBytes > HTML_SNAPSHOT_ZIP_POLICY.maximumDeclaredBytes) invalid();
    const nameBytes = buffer.readUInt16LE(offset + 28), extraBytes = buffer.readUInt16LE(offset + 30),
      commentBytes = buffer.readUInt16LE(offset + 32);
    range(buffer, offset + ZIP.centralBytes, nameBytes + extraBytes + commentBytes, end);
    const name = buffer.subarray(offset + ZIP.centralBytes, offset + ZIP.centralBytes + nameBytes);
    const path = pathName(name, flags), directory = path.endsWith("/");
    if (paths.has(path)) invalid(); paths.add(path);
    const attributes = buffer.readUInt32LE(offset + 38), unixType = (attributes >>> 16) & 0xf000;
    if (unixType && unixType !== (directory ? 0x4000 : 0x8000)
      || Boolean(attributes & 0x10) !== directory || directory && (compressed || expanded)) invalid();
    extras(buffer, offset + ZIP.centralBytes + nameBytes, extraBytes);
    entries.push({ path, bytes: expanded, directory, ...localRange(buffer, offset, start, name, flags, method,
      buffer.readUInt32LE(offset + 16), compressed, expanded) });
    offset += ZIP.centralBytes + nameBytes + extraBytes + commentBytes;
  }
  if (offset !== end) invalid();
  const ordered = [...entries].sort((left, right) => left.start - right.start);
  let next = 0;
  for (const entry of ordered) {
    if (entry.start !== next) invalid(); next = entry.end;
    const segments = entry.path.replace(/\/$/, "").split("/");
    if (entry.directory && paths.has(entry.path.slice(0, -1))) invalid();
    for (let index = 1; index < segments.length; index++) if (paths.has(segments.slice(0, index).join("/"))) invalid();
  }
  if (next !== start) invalid();
  return entries;
}

/** Reads just one member. Declared sizes bound admission; actual streamed bytes
 * are bounded independently. No extraction, CRC sweep or eager decompression. */
export async function readHtmlSnapshotZipMember(params: {
  archiveBytes: Buffer; path: string; maximumBytes: number; signal?: AbortSignal;
}): Promise<Buffer> {
  try {
    if (!Number.isSafeInteger(params.maximumBytes) || params.maximumBytes < 1
      || params.maximumBytes > HTML_SNAPSHOT_ZIP_POLICY.maximumDeclaredBytes) invalid();
    const entries = inspectDirectory(params.archiveBytes, params.signal);
    const selected = entries.find(entry => entry.path === params.path);
    if (!selected || selected.directory || selected.bytes > params.maximumBytes) invalid();
    const archive = await JSZip.loadAsync(params.archiveBytes);
    params.signal?.throwIfAborted();
    const names = Object.keys(archive.files);
    if (names.length !== entries.length || entries.some(entry => {
      const decoded = archive.files[entry.path];
      return !decoded || decoded.dir !== entry.directory || !entry.directory && decoded.unsafeOriginalName !== entry.path;
    })) invalid();
    const member = archive.file(params.path); if (!member) invalid();
    const chunks: Buffer[] = []; let bytes = 0;
    await pipeline(member.nodeStream("nodebuffer"), new Writable({
      write(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > params.maximumBytes || bytes > selected.bytes) return callback(new Error("HTML_SNAPSHOT_ZIP_INVALID"));
        chunks.push(chunk); callback();
      },
    }), { signal: params.signal });
    params.signal?.throwIfAborted();
    if (bytes !== selected.bytes) invalid();
    return Buffer.concat(chunks, bytes);
  } catch {
    params.signal?.throwIfAborted(); invalid();
  }
}

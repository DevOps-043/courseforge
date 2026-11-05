import { COURSE_SOURCE_LIMITS } from "./course-source-policy";
import { CourseSourceError } from "./course-source-error";

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_DIRECTORY_ENTRY_BYTES = 46;
const ZIP_END_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 65_535;
const ZIP64_ENTRY_SENTINEL = 0xffff;

/** Limita la cardinalidad antes de que JSZip materialice el directorio. No descomprime. */
export function verifyOfficeDirectoryHeader(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, buffer.length - ZIP_END_BYTES - ZIP_MAX_COMMENT_BYTES);
  for (let offset = buffer.length - ZIP_END_BYTES; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) !== ZIP_END_SIGNATURE) continue;
    const commentBytes = buffer.readUInt16LE(offset + 20);
    if (offset + ZIP_END_BYTES + commentBytes !== buffer.length) continue;
    const count = buffer.readUInt16LE(offset + 10);
    const diskCount = buffer.readUInt16LE(offset + 8);
    const directoryBytes = buffer.readUInt32LE(offset + 12);
    const directoryOffset = buffer.readUInt32LE(offset + 16);
    if (buffer.readUInt16LE(offset + 4) !== 0 || buffer.readUInt16LE(offset + 6) !== 0
      || count !== diskCount || count === ZIP64_ENTRY_SENTINEL || count > COURSE_SOURCE_LIMITS.officeEntries
      || directoryOffset + directoryBytes !== offset) break;
    let cursor = directoryOffset;
    for (let index = 0; index < count; index++) {
      if (cursor + ZIP_DIRECTORY_ENTRY_BYTES > offset || buffer.readUInt32LE(cursor) !== ZIP_DIRECTORY_SIGNATURE) {
        invalidDirectory();
      }
      const filenameBytes = buffer.readUInt16LE(cursor + 28);
      const extraBytes = buffer.readUInt16LE(cursor + 30);
      const entryCommentBytes = buffer.readUInt16LE(cursor + 32);
      cursor += ZIP_DIRECTORY_ENTRY_BYTES + filenameBytes + extraBytes + entryCommentBytes;
      if (cursor > offset) invalidDirectory();
    }
    if (cursor !== offset) invalidDirectory();
    return;
  }
  invalidDirectory();
}

function invalidDirectory(): never {
  throw new CourseSourceError(415, "El archivo Office tiene un directorio inválido o excede el límite de entradas.");
}

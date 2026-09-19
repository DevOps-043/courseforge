import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedGoogleFontCssUrl,
  validateOrganizationFontBinary,
} from "../organization-font-upload-policy.service";

test("accepts only the exact HTTPS Google Fonts stylesheet host", () => {
  assert.equal(isAllowedGoogleFontCssUrl("https://fonts.googleapis.com/css2?family=Inter"), true);
  assert.equal(isAllowedGoogleFontCssUrl("https://fonts.googleapis.com.evil.example/css2?family=Inter"), false);
  assert.equal(isAllowedGoogleFontCssUrl("http://fonts.googleapis.com/css2?family=Inter"), false);
  assert.equal(isAllowedGoogleFontCssUrl("https://user@fonts.googleapis.com/css2?family=Inter"), false);
});

test("rejects a font whose extension does not match its binary signature", () => {
  const bytes = new Uint8Array(48);
  writeTag(bytes, 0, "wOF2");
  writeUint32(bytes, 8, bytes.byteLength);
  writeUint16(bytes, 12, 1);
  assert.throws(() => validateOrganizationFontBinary(bytes, "ttf"), /firma binaria/);
});

test("accepts a structurally bounded TTF with an embeddable OS/2 table", () => {
  const bytes = createTtf(0);
  assert.deepEqual(validateOrganizationFontBinary(bytes, "ttf"), {
    detectedExtension: "ttf",
    embedding: "ALLOWED",
  });
});

test("rejects a TTF whose internal license marks embedding as restricted", () => {
  const bytes = createTtf(0x0002);
  assert.throws(() => validateOrganizationFontBinary(bytes, "ttf"), /restringe su embedding/);
});

test("rejects a table that points outside the uploaded file", () => {
  const bytes = createTtf(0);
  writeUint32(bytes, 12 + 8, bytes.byteLength + 1);
  assert.throws(() => validateOrganizationFontBinary(bytes, "ttf"), /fuera del archivo/);
});

function createTtf(fsType: number) {
  const bytes = new Uint8Array(58);
  writeUint32(bytes, 0, 0x00010000);
  writeUint16(bytes, 4, 2);
  writeTag(bytes, 12, "name");
  writeUint32(bytes, 20, 44);
  writeUint32(bytes, 24, 4);
  writeTag(bytes, 28, "OS/2");
  writeUint32(bytes, 36, 48);
  writeUint32(bytes, 40, 10);
  writeUint16(bytes, 56, fsType);
  return bytes;
}

function writeTag(bytes: Uint8Array, offset: number, tag: string) {
  for (let index = 0; index < 4; index += 1) bytes[offset + index] = tag.charCodeAt(index);
}

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint16(offset, value, false);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint32(offset, value, false);
}

import assert from "node:assert/strict";
import test from "node:test";
import type { GooglePickerNamespace } from "../google-picker-runtime.types";
import { readGooglePickerFileId } from "../google-picker-runtime.types";

const pickerKeys = {
  Document: { ID: "id" },
  Response: { ACTION: "action", DOCUMENTS: "documents" },
} as GooglePickerNamespace;

test("Google Picker extracts only a non-empty string file ID", () => {
  assert.equal(
    readGooglePickerFileId({ documents: [{ id: "drive-file-1" }] }, pickerKeys),
    "drive-file-1",
  );
  assert.equal(readGooglePickerFileId({ documents: [{ id: 42 }] }, pickerKeys), null);
  assert.equal(readGooglePickerFileId({ documents: [] }, pickerKeys), null);
  assert.equal(readGooglePickerFileId({ documents: "invalid" }, pickerKeys), null);
});

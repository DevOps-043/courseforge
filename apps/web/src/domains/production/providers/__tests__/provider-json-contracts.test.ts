import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAccessTokenPayload,
  parseArtlistDownloadPayload,
  parseGoogleAccountProfile,
  parseGoogleDriveFileList,
  parseMicrosoftAccountProfile,
  parseMicrosoftGraphItem,
  parseMicrosoftGraphItemList,
} from "../provider-json-contracts";

test("provider token contracts require a usable token and optional positive expiry", () => {
  assert.deepEqual(parseAccessTokenPayload({ access_token: "token" }, "Artlist"), {
    accessToken: "token",
    expiresIn: undefined,
    refreshToken: undefined,
  });
  assert.throws(() => parseAccessTokenPayload({ access_token: "" }, "Google"), /access_token/);
  assert.throws(
    () => parseAccessTokenPayload({ access_token: "token", expires_in: -1 }, "Microsoft", true),
    /expires_in/,
  );
});

test("OAuth account profiles require a non-empty provider email", () => {
  assert.deepEqual(parseGoogleAccountProfile({ email: "owner@example.com" }), {
    email: "owner@example.com",
  });
  assert.deepEqual(
    parseMicrosoftAccountProfile({ mail: "", userPrincipalName: "owner@example.com" }),
    { email: "owner@example.com" },
  );
  assert.throws(() => parseGoogleAccountProfile({ email: "" }), /email/);
  assert.throws(() => parseMicrosoftAccountProfile({}), /email/);
});

test("provider metadata contracts sanitize optional values and reject invalid containers", () => {
  assert.deepEqual(parseArtlistDownloadPayload({ download_url: "https://cdn.example/file", duration: 12 }), {
    downloadUrl: "https://cdn.example/file",
    duration: 12,
  });
  assert.throws(() => parseArtlistDownloadPayload([]), /objeto JSON invalido/);
  assert.deepEqual(
    parseMicrosoftGraphItem({
      file: { mimeType: "video/mp4" },
      id: "item-1",
      name: "video.mp4",
      size: 42,
    }),
    {
      id: "item-1",
      isFolder: false,
      mimeType: "video/mp4",
      name: "video.mp4",
      size: 42,
      webUrl: undefined,
    },
  );
});

test("provider listings drop malformed entries but require the collection contract", () => {
  assert.deepEqual(
    parseGoogleDriveFileList({
      files: [
        { id: "ok", mimeType: "video/mp4", name: "video", size: "128" },
        { id: "missing-fields" },
      ],
    }),
    [{ id: "ok", mimeType: "video/mp4", name: "video", size: 128 }],
  );
  assert.deepEqual(
    parseMicrosoftGraphItemList({
      value: [
        { id: "folder", name: "Folder", folder: {} },
        { id: "invalid" },
      ],
    }),
    [{
      id: "folder",
      isFolder: true,
      mimeType: undefined,
      name: "Folder",
      size: undefined,
      webUrl: undefined,
    }],
  );
  assert.throws(() => parseGoogleDriveFileList({ files: {} }), /listado/);
});

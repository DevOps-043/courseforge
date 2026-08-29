import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HeygenRepository,
  resolveHeygenStorageObjectPath,
} from "../heygen.repository";
import { PRODUCTION_ASSET_TYPES } from "../../../types/production.types";

const JOB_ID = "79303fcf-9c19-4a5b-b39f-a6b075ad29be";
const ASSET_ID = "1e4404a6-7bfc-41a2-97b0-e8be9382e35a";
const OBJECT_PATH = `heygen/artifact/component/${JOB_ID}-voice.mp3`;

describe("HeyGen generated asset storage reconciliation", () => {
  it("normalizes only references inside the HeyGen production prefix", () => {
    assert.equal(
      resolveHeygenStorageObjectPath({
        storage_bucket: "production-assets",
        storage_path: `production-assets/${OBJECT_PATH}`,
      }),
      OBJECT_PATH,
    );
    assert.equal(
      resolveHeygenStorageObjectPath({
        storage_bucket: "production-render-sources",
        storage_path: `production-render-sources/${OBJECT_PATH}`,
      }),
      null,
    );
    assert.equal(
      resolveHeygenStorageObjectPath({
        storage_bucket: "production-assets",
        storage_path: "production-assets/heygen/../private/object.mp3",
      }),
      null,
    );
  });

  it("returns an active database asset when its storage object exists", async () => {
    const fake = createRepositoryFake({ exists: true });
    const repository = new HeygenRepository(fake.client as never);

    const asset = await repository.findVoiceAudioAssetByJob(JOB_ID);

    assert.equal(asset?.id, ASSET_ID);
    assert.equal(fake.archivedUpdates.length, 0);
    assert.deepEqual(fake.listCalls, [{
      bucket: "production-assets",
      directory: "heygen/artifact/component",
      search: `${JOB_ID}-voice.mp3`,
    }]);
  });

  it("archives and suppresses a database asset whose storage object is missing", async () => {
    const fake = createRepositoryFake({ exists: false });
    const repository = new HeygenRepository(fake.client as never);

    const asset = await repository.findGeneratedAssetByJob(
      JOB_ID,
      PRODUCTION_ASSET_TYPES.VOICE_AUDIO,
    );

    assert.equal(asset, null);
    assert.equal(fake.archivedUpdates.length, 1);
    assert.equal(fake.archivedUpdates[0]?.payload.public_url, null);
    assert.equal(fake.archivedUpdates[0]?.payload.qa_status, "ARCHIVED");
    assert.equal(
      (fake.archivedUpdates[0]?.payload.metadata as Record<string, unknown>)
        .archive_reason,
      "STORAGE_OBJECT_MISSING",
    );
    assert.equal(fake.archivedUpdates[0]?.assetId, ASSET_ID);
  });

  it("fails closed on storage errors without archiving a potentially valid asset", async () => {
    const fake = createRepositoryFake({
      exists: false,
      storageError: { message: "storage unavailable" },
    });
    const repository = new HeygenRepository(fake.client as never);

    await assert.rejects(
      repository.findVoiceAudioAssetByJob(JOB_ID),
      (error: unknown) =>
        Boolean(
          error &&
          typeof error === "object" &&
          "message" in error &&
          error.message === "storage unavailable",
        ),
    );
    assert.equal(fake.archivedUpdates.length, 0);
  });
});

describe("HeyGen catalog cleanup", () => {
  it("archives a non-default preset without deleting it", async () => {
    const fake = createCatalogArchiveFake({ isDefault: false });
    const repository = new HeygenRepository(fake.client as never);

    const result = await repository.setCatalogPresetArchived({
      archived: true,
      kind: "voice",
      organizationId: "22222222-2222-4222-8222-222222222222",
      presetId: "33333333-3333-4333-8333-333333333333",
    });

    assert.equal(result, "UPDATED");
    assert.equal(typeof fake.updates[0]?.archived_at, "string");
  });

  it("protects the default preset from cleanup", async () => {
    const fake = createCatalogArchiveFake({ isDefault: true });
    const repository = new HeygenRepository(fake.client as never);

    const result = await repository.setCatalogPresetArchived({
      archived: true,
      kind: "avatar",
      organizationId: "22222222-2222-4222-8222-222222222222",
      presetId: "33333333-3333-4333-8333-333333333333",
    });

    assert.equal(result, "DEFAULT");
    assert.equal(fake.updates.length, 0);
  });
});

function createRepositoryFake(params: {
  exists: boolean;
  storageError?: { message: string } | null;
}) {
  const archivedUpdates: Array<{
    assetId: string;
    payload: Record<string, unknown>;
  }> = [];
  const listCalls: Array<{
    bucket: string;
    directory: string;
    search: string;
  }> = [];
  const assetRow = {
    duration_milliseconds: 186_000,
    duration_seconds: 186,
    id: ASSET_ID,
    metadata: { imported_at: "2026-08-25T23:37:34.964Z" },
    mime_type: "audio/mpeg",
    public_url: `https://storage.example.test/object/public/production-assets/${OBJECT_PATH}`,
    storage_bucket: "production-assets",
    storage_path: `production-assets/${OBJECT_PATH}`,
  };

  const selectQuery = {
    eq() { return this; },
    neq() { return this; },
    order() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: assetRow, error: null }; },
  };

  const client = {
    from(table: string) {
      assert.equal(table, "production_assets");
      return {
        select() { return selectQuery; },
        update(payload: Record<string, unknown>) {
          return {
            async eq(column: string, assetId: string) {
              assert.equal(column, "id");
              archivedUpdates.push({ assetId, payload });
              return { error: null };
            },
          };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async list(
            directory: string,
            options: { search?: string },
          ) {
            listCalls.push({
              bucket,
              directory,
              search: options.search || "",
            });
            return {
              data: params.exists
                ? [{ name: options.search || "" }]
                : [],
              error: params.storageError || null,
            };
          },
        };
      },
    },
  };

  return { archivedUpdates, client, listCalls };
}

function createCatalogArchiveFake(params: { isDefault: boolean }) {
  const updates: Array<Record<string, unknown>> = [];
  const readQuery = {
    eq() { return this; },
    async maybeSingle() {
      return { data: { id: "33333333-3333-4333-8333-333333333333", is_default: params.isDefault }, error: null };
    },
  };
  const client = {
    from(table: string) {
      assert.ok(table === "heygen_avatar_presets" || table === "heygen_voice_presets");
      return {
        select() { return readQuery; },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return {
            eq() {
              return {
                async eq() { return { error: null }; },
              };
            },
          };
        },
      };
    },
  };
  return { client, updates };
}

import type { HeygenAvatarLook, HeygenVoice } from "./heygen.types";
import {
  getObjectArrayField,
  getStringArrayField,
  getStringField,
  heygenAvatarLookSchema,
  heygenVoiceSchema,
  toRecord,
} from "./heygen.validators";

export function normalizeAvatarLooks(rawResponse: unknown): HeygenAvatarLook[] {
  const items = extractHeygenItems(rawResponse, [
    "avatar_looks",
    "avatarLooks",
    "looks",
    "avatars",
    "items",
  ]);

  return items.map((item) => {
    const normalized = {
      avatarType: getStringField(item, ["avatar_type", "avatarType", "type"]),
      defaultVoiceId: getStringField(item, [
        "default_voice_id",
        "defaultVoiceId",
        "voice_id",
      ]),
      groupId: getStringField(item, ["group_id", "avatar_group_id", "groupId"]),
      id: getStringField(item, ["id", "avatar_id", "avatarId"]) || "",
      metadata: buildMinimalMetadata(item),
      name: getStringField(item, ["name", "avatar_name", "display_name"]) || "HeyGen avatar",
      previewImageUrl: getStringField(item, [
        "preview_image_url",
        "previewImageUrl",
        "thumbnail_url",
        "image_url",
      ]),
      previewVideoUrl: getStringField(item, [
        "preview_video_url",
        "previewVideoUrl",
        "video_url",
      ]),
      status: getStringField(item, ["status"]),
      supportedApiEngines: getStringArrayField(item, [
        "supported_api_engines",
        "supportedApiEngines",
        "engines",
      ]),
    };

    return heygenAvatarLookSchema.parse(normalized);
  });
}

export function normalizeVoices(rawResponse: unknown): HeygenVoice[] {
  const items = extractHeygenItems(rawResponse, [
    "voices",
    "voice_list",
    "voiceList",
    "items",
  ]);

  return items.map((item) => {
    const normalized = {
      gender: getStringField(item, ["gender"]),
      id: getStringField(item, ["id", "voice_id", "voiceId"]) || "",
      language: getStringField(item, ["language", "locale", "language_code"]),
      metadata: {
        ...buildMinimalMetadata(item),
        ownership: getStringField(item, ["ownership", "type"]),
      },
      name: getStringField(item, ["name", "voice_name", "display_name"]) || "HeyGen voice",
      previewAudioUrl: getStringField(item, [
        "preview_audio_url",
        "previewAudioUrl",
        "preview_url",
      ]),
      type: getStringField(item, ["type", "voice_type"]),
    };

    return heygenVoiceSchema.parse(normalized);
  });
}

function extractHeygenItems(
  rawResponse: unknown,
  itemKeys: string[],
): Record<string, unknown>[] {
  const directItems = toRecordArray(rawResponse);
  if (directItems.length > 0) return directItems;

  const root = toRecord(rawResponse);
  if (!root) return [];

  const rootItems = getObjectArrayField(root, itemKeys);
  if (rootItems.length > 0) return rootItems;

  const dataArrayItems = toRecordArray(root.data);
  if (dataArrayItems.length > 0) return dataArrayItems;

  const dataItems = getObjectArrayField(root.data, itemKeys);
  if (dataItems.length > 0) return dataItems;

  const data = toRecord(root.data);
  if (data) {
    const nestedDataItems = getObjectArrayField(data.data, itemKeys);
    if (nestedDataItems.length > 0) return nestedDataItems;
  }

  return [];
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (entry): entry is Record<string, unknown> => Boolean(toRecord(entry)),
  );
}

function buildMinimalMetadata(item: Record<string, unknown>) {
  return {
    engine: getStringField(item, ["engine", "engine_type"]),
    locale: getStringField(item, ["locale", "language_code"]),
    ownership: getStringField(item, ["ownership"]),
    premium: item.premium === true || item.is_premium === true,
    supports_matting:
      item.supports_matting === true || item.matting_enabled === true,
    source: "heygen_api_v3",
    synced_fields: Object.keys(item).sort(),
  };
}

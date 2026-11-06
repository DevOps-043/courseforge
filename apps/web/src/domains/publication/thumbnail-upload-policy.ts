export const THUMBNAIL_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const THUMBNAIL_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export function getThumbnailUploadExtension(contentType: string | undefined) {
  return contentType ? THUMBNAIL_EXTENSIONS.get(contentType) : undefined;
}

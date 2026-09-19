export const ORGANIZATION_FONT_STORAGE_BUCKET = "organization-fonts";
export const ORGANIZATION_FONT_TABLE = "organization_slide_fonts";

export type OrganizationFontStatus = "LEGACY" | "READY" | "REJECTED";

export type OrganizationFontRecord = {
  checksumSha256: string;
  family: string;
  fileSizeBytes: number;
  id: string;
  mimeType: string;
  status: OrganizationFontStatus;
  storageBucket: string;
  storagePath: string;
};

export type CompositionCompiledFont = {
  assetId: string;
  family: string;
  format: "opentype" | "truetype" | "woff" | "woff2";
  sourceUrl: string;
};

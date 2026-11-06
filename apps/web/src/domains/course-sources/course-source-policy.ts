export const COURSE_SOURCE_BUCKET = "course-source-originals";
export const COURSE_SOURCE_LIMITS = {
  fileBytes: 15 * 1024 * 1024,
  courseDocuments: 50,
  courseBytes: 200 * 1024 * 1024,
  organizationDocuments: 500,
  organizationBytes: 2 * 1024 * 1024 * 1024,
  requestBytes: 4096,
  reviewRequestBytes: 512 * 1024,
  reviewEvidenceBytes: 2 * 1024 * 1024,
  pageSize: 20,
  maxPageSize: 50,
  officeEntries: 2000,
} as const;

export const COURSE_SOURCE_FORMATS = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
} as const;

export type CourseSourceFormat = keyof typeof COURSE_SOURCE_FORMATS;
export type CourseSourcePolicy = "DOCUMENTS_ONLY" | "DOCUMENTS_AND_WEB" | "WEB_ONLY";

export type CurationSourceOrigin = "automatic" | "manual";
export type CurationSourceKind = "url" | "pdf";
export type CurationValidationStatus =
  | "pending"
  | "valid"
  | "invalid"
  | "review_required";

export interface CurationValidationReport {
  status: CurationValidationStatus;
  checked_at: string;
  reason: string;
  normalized_url?: string;
  http_status_code?: number | null;
  content_characters?: number;
  content_excerpt?: string;
  content_sha256?: string;
  detected_title?: string;
  checks: {
    blocked_domain: boolean;
    duplicate: boolean;
    http_ok: boolean;
    minimum_content: boolean;
    paywall: boolean;
    soft_404: boolean;
    valid_mime: boolean;
  };
}

export interface UrlValidationResult {
  isValid: boolean;
  normalizedUrl: string;
  report: CurationValidationReport;
}

export interface PdfValidationResult {
  isValid: boolean;
  report: CurationValidationReport;
  sha256: string;
}

export interface CurationCandidate {
  lesson_id: string;
  url: string;
  title: string;
  rationale: string;
  search_query?: string;
}

export interface CurationLesson {
  lesson_id: string;
  lesson_title: string;
  lesson_objective: string;
  module_title: string;
}

export interface CurationCoverageItem {
  lessonId: string;
  lessonTitle: string;
  validCount: number;
  targetCount: number;
  isCovered: boolean;
}

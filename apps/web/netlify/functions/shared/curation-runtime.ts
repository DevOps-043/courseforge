import { getErrorMessage } from "./errors";
import {
  OutboundResponseTooLargeError,
  readResponseTextWithLimit,
} from "../../../src/lib/server/outbound-http";
import { fetchPublicUrlWithRedirects } from "../../../src/lib/server/public-url-policy";
import {
  CURATION_CONTENT_VALIDATION_TIMEOUT_MS,
  CURATION_REDIRECT_RESOLUTION_TIMEOUT_MS,
} from "./timing";

const MIN_CONTENT_LENGTH = 500;
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export const LESSONS_PER_BATCH = 2;
export const SOURCES_PER_LESSON = 2;
export const DEFAULT_MODEL = "gpt-5.6-luna";
export const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash";
export const GEMINI_QUOTA_FALLBACK_MODEL = "gemini-2.5-flash";
export const DELAY_BETWEEN_BATCHES_MS = 5000;

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function resolveRedirectUrl(
  url: string,
  timeoutMs = CURATION_REDIRECT_RESOLUTION_TIMEOUT_MS,
): Promise<string> {
  try {
    const result = await fetchPublicUrlWithRedirects(url, {
      method: 'HEAD',
      maximumRedirects: MAX_REDIRECTS,
      timeoutMilliseconds: timeoutMs,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    await result.response.body?.cancel().catch(() => undefined);
    return result.url.toString();
  } catch {
    return url;
  }
}

export async function validateUrlWithContent(
  url: string,
  timeoutMs = CURATION_CONTENT_VALIDATION_TIMEOUT_MS,
): Promise<{ isValid: boolean; reason: string; contentLength: number }> {
  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  };

  try {
    const { response } = await fetchPublicUrlWithRedirects(url, {
      method: 'GET',
      maximumRedirects: MAX_REDIRECTS,
      timeoutMilliseconds: timeoutMs,
      headers: browserHeaders,
    });

    if (response.status >= 400) {
      await response.body?.cancel().catch(() => undefined);
      return {
        isValid: false,
        reason: `HTTP ${response.status}`,
        contentLength: 0,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/(?:text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      return {
        isValid: false,
        reason: "Unsupported content type",
        contentLength: 0,
      };
    }

    const html = await readResponseTextWithLimit(response, MAX_CONTENT_BYTES);
    const soft404Patterns = [
      /page\s*(not|no)\s*found/i,
      /404\s*(error|not found|página)/i,
      /no\s*se\s*encontr(ó|o)/i,
      /<title>[^<]*404[^<]*<\/title>/i,
    ];

    for (const pattern of soft404Patterns) {
      if (pattern.test(html)) {
        return { isValid: false, reason: 'Soft 404', contentLength: 0 };
      }
    }

    const paywallPatterns = [
      /sign\s*in\s*to\s*(continue|access)/i,
      /subscribe\s*to\s*(read|access)/i,
    ];

    for (const pattern of paywallPatterns) {
      if (pattern.test(html) && html.length < 5000) {
        return { isValid: false, reason: 'Paywall', contentLength: 0 };
      }
    }

    const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (textContent.length < MIN_CONTENT_LENGTH) {
      return {
        isValid: false,
        reason: `Too short (${textContent.length} chars)`,
        contentLength: textContent.length,
      };
    }

    return { isValid: true, reason: 'OK', contentLength: textContent.length };
  } catch (error: unknown) {
    const reason = error instanceof OutboundResponseTooLargeError
      ? "Response too large (max 2 MiB)"
      : error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? "Validation timed out"
        : getErrorMessage(error);
    return {
      isValid: false,
      reason,
      contentLength: 0,
    };
  }
}

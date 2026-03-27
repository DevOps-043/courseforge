const MIN_CONTENT_LENGTH = 500;

export const LESSONS_PER_BATCH = 2;
export const SOURCES_PER_LESSON = 2;
export const DEFAULT_MODEL = 'gemini-2.0-flash';
export const DEFAULT_FALLBACK_MODEL = 'gemini-1.5-pro';
export const DELAY_BETWEEN_BATCHES_MS = 5000;

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function resolveRedirectUrl(
  url: string,
  timeoutMs = 8000,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    clearTimeout(timeoutId);
    return response.url || url;
  } catch {
    return url;
  }
}

export async function validateUrlWithContent(
  url: string,
  timeoutMs = 10000,
): Promise<{ isValid: boolean; reason: string; contentLength: number }> {
  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: browserHeaders,
    });

    clearTimeout(timeoutId);

    if (response.status >= 400) {
      return {
        isValid: false,
        reason: `HTTP ${response.status}`,
        contentLength: 0,
      };
    }

    const html = await response.text();
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
    return {
      isValid: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
      contentLength: 0,
    };
  }
}

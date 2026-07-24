import { createHash } from "node:crypto";
import type {
  CurationValidationReport,
  PdfValidationResult,
  UrlValidationResult,
} from "./types";

export const MINIMUM_SOURCE_CHARACTERS = 500;
export const MINIMUM_PDF_CHARACTERS = 500;

const BLOCKED_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "pinterest.com",
  "quora.com",
  "reddit.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
];

const PAYWALL_PATTERNS = [
  /already a subscriber/i,
  /continue reading with (?:a )?subscription/i,
  /create an account to continue/i,
  /register to continue reading/i,
  /subscribe (?:now )?to (?:continue|read)/i,
  /subscription required/i,
  /this article is for subscribers/i,
  /unlock this article/i,
];

const SOFT_404_PATTERNS = [
  /404\s*[-|:]?\s*(?:page )?not found/i,
  /page (?:does not|doesn't) exist/i,
  /page (?:is no longer|isn['’]t) available/i,
  /the requested (?:page|resource) could not be found/i,
  /we can['’]t find (?:that|the) page/i,
];

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
]);

function emptyChecks() {
  return {
    blocked_domain: false,
    duplicate: false,
    http_ok: false,
    minimum_content: false,
    paywall: false,
    soft_404: false,
    valid_mime: false,
  };
}

function buildReport(
  status: CurationValidationReport["status"],
  reason: string,
  checks = emptyChecks(),
): CurationValidationReport {
  return {
    status,
    checked_at: new Date().toISOString(),
    reason,
    checks,
  };
}

export function normalizeSourceUrl(rawUrl: string) {
  const url = new URL(rawUrl.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("La fuente debe usar HTTP o HTTPS.");
  }

  url.protocol = "https:";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.port === "80" || url.port === "443") url.port = "";

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.toString();
}

export function isBlockedSourceDomain(rawUrl: string) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return BLOCKED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return true;
  }
}

export function isSoft404Content(content: string) {
  const sample = content.slice(0, 20_000);
  return SOFT_404_PATTERNS.some((pattern) => pattern.test(sample));
}

export function hasPaywallContent(content: string) {
  const sample = content.slice(0, 40_000);
  return PAYWALL_PATTERNS.some((pattern) => pattern.test(sample));
}

export function extractReadableText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHtmlTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? extractReadableText(match[1]).slice(0, 240) : undefined;
}

export async function validateUrlSource(
  rawUrl: string,
  options: {
    existingNormalizedUrls?: Iterable<string>;
    fetchImpl?: typeof fetch;
    minimumCharacters?: number;
  } = {},
): Promise<UrlValidationResult> {
  let normalizedUrl = rawUrl.trim();
  const checks = emptyChecks();

  try {
    normalizedUrl = normalizeSourceUrl(rawUrl);
  } catch (error) {
    const report = buildReport(
      "invalid",
      error instanceof Error ? error.message : "URL invalida.",
      checks,
    );
    return { isValid: false, normalizedUrl, report };
  }

  checks.blocked_domain = isBlockedSourceDomain(normalizedUrl);
  if (checks.blocked_domain) {
    const report = buildReport("invalid", "El dominio no esta permitido como fuente.", checks);
    report.normalized_url = normalizedUrl;
    return { isValid: false, normalizedUrl, report };
  }

  const existing = new Set(options.existingNormalizedUrls || []);
  checks.duplicate = existing.has(normalizedUrl);
  if (checks.duplicate) {
    const report = buildReport("invalid", "La fuente ya esta registrada.", checks);
    report.normalized_url = normalizedUrl;
    return { isValid: false, normalizedUrl, report };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await (options.fetchImpl || fetch)(normalizedUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
        "user-agent": "CourseforgeSourceValidator/2.0",
      },
    });
    checks.http_ok = response.ok;
    checks.valid_mime = /(?:text\/html|application\/xhtml\+xml|text\/plain)/i.test(
      response.headers.get("content-type") || "",
    );
    const html = await response.text();
    const readable = extractReadableText(html);
    checks.soft_404 = isSoft404Content(readable);
    checks.paywall = hasPaywallContent(readable);
    checks.minimum_content =
      readable.length >= (options.minimumCharacters || MINIMUM_SOURCE_CHARACTERS);

    let reason = "Fuente valida.";
    if (!checks.http_ok) reason = `La fuente respondio HTTP ${response.status}.`;
    else if (!checks.valid_mime) reason = "La URL no contiene una pagina de texto compatible.";
    else if (checks.soft_404) reason = "La pagina parece ser un soft 404.";
    else if (checks.paywall) reason = "La pagina requiere pago, registro o suscripcion.";
    else if (!checks.minimum_content) reason = "La pagina no contiene suficiente contenido educativo.";

    const isValid =
      checks.http_ok &&
      checks.valid_mime &&
      !checks.soft_404 &&
      !checks.paywall &&
      checks.minimum_content;
    const report = buildReport(isValid ? "valid" : "invalid", reason, checks);
    report.normalized_url = normalizeSourceUrl(response.url || normalizedUrl);
    report.http_status_code = response.status;
    report.content_characters = readable.length;
    report.content_excerpt = readable.slice(0, 6_000);
    report.detected_title = extractHtmlTitle(html);
    return {
      isValid,
      normalizedUrl: report.normalized_url,
      report,
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "La validacion excedio el tiempo limite."
        : error instanceof Error
          ? error.message
          : "No fue posible acceder a la fuente.";
    const report = buildReport("review_required", reason, checks);
    report.normalized_url = normalizedUrl;
    return { isValid: false, normalizedUrl, report };
  } finally {
    clearTimeout(timeout);
  }
}

function decodePdfString(value: string) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, token: string) => {
      const map: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "(": "(",
        ")": ")",
        "\\": "\\",
      };
      return map[token] || token;
    })
    .replace(/\\[0-7]{1,3}/g, " ");
}

export function extractPdfText(buffer: Uint8Array) {
  const binary = Buffer.from(buffer).toString("latin1");
  const textOperators = [...binary.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*T[Jj]/g)]
    .map((match) => decodePdfString(match[1]))
    .join(" ");
  const arrayOperators = [...binary.matchAll(/\[(.*?)\]\s*TJ/gs)]
    .flatMap((match) => [...match[1].matchAll(/\(([^()]*(?:\\.[^()]*)*)\)/g)])
    .map((match) => decodePdfString(match[1]))
    .join(" ");
  return `${textOperators} ${arrayOperators}`.replace(/\s+/g, " ").trim();
}

async function extractPdfTextWithParser(buffer: Uint8Array) {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text.replace(/\s+/g, " ").trim();
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch (error) {
    console.warn("[CurationV2] PDF parser unavailable; using fallback extractor.", error);
    return extractPdfText(buffer);
  }
}

export async function validatePdfBuffer(
  buffer: Uint8Array,
  mimeType: string,
  minimumCharacters = MINIMUM_PDF_CHARACTERS,
): Promise<PdfValidationResult> {
  const checks = emptyChecks();
  checks.http_ok = true;
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const hasPdfHeader = Buffer.from(buffer.slice(0, 5)).toString("ascii") === "%PDF-";
  checks.valid_mime = mimeType === "application/pdf" && hasPdfHeader;
  let text = "";
  if (checks.valid_mime) {
    text = await extractPdfTextWithParser(buffer);
  }
  checks.minimum_content = text.length >= minimumCharacters;

  let reason = "PDF valido.";
  if (!checks.valid_mime) reason = "El archivo no es un PDF valido.";
  else if (!checks.minimum_content) {
    reason = "El PDF no contiene suficiente texto extraible; puede estar vacio o escaneado.";
  }

  const isValid = checks.valid_mime && checks.minimum_content;
  const report = buildReport(isValid ? "valid" : "invalid", reason, checks);
  report.content_characters = text.length;
  report.content_excerpt = text.slice(0, 12_000);
  report.content_sha256 = sha256;
  return { isValid, report, sha256 };
}

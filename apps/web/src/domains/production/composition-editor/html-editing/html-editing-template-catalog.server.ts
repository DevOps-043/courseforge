import { z } from "zod";
import { HTML_EDITING_LIMITS } from "./html-editing.contract";
import { htmlEditingTrustedTemplateSchema } from "./html-editing-bootstrap.server";
import { decodeHtmlEditingBoundedJson } from "./html-editing-validation";

export const HTML_EDITING_CATALOG_POLICY = Object.freeze({ maximumBytes: 4 * 1024 * 1024, maximumTemplates: 32 });
const catalogSchema = z.object({
  format: z.literal("courseforge-html-editable-catalog-v1"),
  organizationId: z.string().uuid(),
  templates: z.array(htmlEditingTrustedTemplateSchema).max(HTML_EDITING_CATALOG_POLICY.maximumTemplates),
}).strict();
export class HtmlEditingCatalogError extends Error {
  constructor(readonly code: "INVALID_CATALOG" | "TEMPLATE_UNAVAILABLE") {
    super(`HTML_EDITING_${code}`); this.name = "HtmlEditingCatalogError";
  }
}

/** Operator-installed, tenant-scoped snapshot. JSON integrity does NOT establish
 * trust: construction must use independently managed server configuration, never
 * a request body or a URL supplied by a client. No fetch/fallback/global catalog.
 * Reconstruct on configuration revocation; previously registered templates still
 * require the durable template-revocation path and current-grant checks. */
export class HtmlEditingTemplateCatalog {
  readonly #organizationId: string;
  readonly #templates = new Map<string, { sourceSha256: string; encodedTemplate: string }>();

  constructor(encodedTrustedCatalog: string) {
    try {
      const catalog = catalogSchema.parse(decodeHtmlEditingBoundedJson(encodedTrustedCatalog, HTML_EDITING_CATALOG_POLICY.maximumBytes));
      this.#organizationId = catalog.organizationId;
      for (const template of catalog.templates) {
        const key = `${template.templateId}:${template.templateVersion}`;
        const encodedTemplate = JSON.stringify(template);
        if (this.#templates.has(key) || Buffer.byteLength(encodedTemplate, "utf8") > HTML_EDITING_LIMITS.manifestBytes) {
          throw new Error();
        }
        this.#templates.set(key, { sourceSha256: template.sourceSha256, encodedTemplate });
      }
    } catch { throw new HtmlEditingCatalogError("INVALID_CATALOG"); }
  }

  resolve(input: { organizationId: string; templateId: string; templateVersion: number; sourceSha256: string }): string {
    const selection = htmlEditingTrustedTemplateSchema.pick({ templateId: true, templateVersion: true, sourceSha256: true }).safeParse({
      templateId: input.templateId, templateVersion: input.templateVersion, sourceSha256: input.sourceSha256,
    });
    const template = selection.success ? this.#templates.get(`${selection.data.templateId}:${selection.data.templateVersion}`) : undefined;
    if (input.organizationId !== this.#organizationId || !template || template.sourceSha256 !== input.sourceSha256) {
      throw new HtmlEditingCatalogError("TEMPLATE_UNAVAILABLE");
    }
    return template.encodedTemplate;
  }
}

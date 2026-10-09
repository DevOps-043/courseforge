import { z } from "zod";

export const HTML_EDITING_TEXT_LOCALE_POLICY = Object.freeze({ locales: 32, languageCharacters: 64 });
const language = z.string().min(2).max(HTML_EDITING_TEXT_LOCALE_POLICY.languageCharacters)
  .regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).refine(value => {
    try { return Intl.getCanonicalLocales(value)[0] === value; } catch { return false; }
  });
export const htmlEditingTextLocaleSchema = z.object({ language, direction: z.enum(["ltr", "rtl", "auto"]) }).strict();
export type HtmlEditingTextLocale = z.infer<typeof htmlEditingTextLocaleSchema>;
export function htmlEditingTextLocalesMatch(first: HtmlEditingTextLocale, second: HtmlEditingTextLocale): boolean {
  return first.language === second.language && first.direction === second.direction;
}
export const htmlEditingTextLocaleDeclarationSchema = z.object({
  defaultLocale: htmlEditingTextLocaleSchema,
  allowedLocales: z.array(htmlEditingTextLocaleSchema).min(1).max(HTML_EDITING_TEXT_LOCALE_POLICY.locales),
}).strict().superRefine((policy, context) => {
  const keys = policy.allowedLocales.map(locale => `${locale.language}:${locale.direction}`);
  if (new Set(keys).size !== keys.length || !policy.allowedLocales.some(locale => htmlEditingTextLocalesMatch(locale, policy.defaultLocale)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid text locale declaration" });
});

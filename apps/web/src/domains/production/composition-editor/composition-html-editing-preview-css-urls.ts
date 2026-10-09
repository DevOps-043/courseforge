const fragment = /^#[a-zA-Z_][\w.-]*$/;
/** Limited admitted url() grammar. Never replace content strings/comments or
 * fragment identities; the same walker is used by issuer and frame updater. */
export function bindHtmlPreviewCssUrls(value: string, bind: (reference: string) => string) {
  let output = "", index = 0;
  while (index < value.length) {
    const character = value[index]!;
    if (character === "'" || character === '"') {
      const start = index++, quote = character;
      while (index < value.length && value[index] !== quote) {
        if (value[index] === "\\") index++;
        index++;
      }
      if (index >= value.length) throw new Error("HTML_PREVIEW_CSS_URL_INVALID");
      output += value.slice(start, ++index); continue;
    }
    if (value.startsWith("/*", index)) {
      const end = value.indexOf("*/", index + 2);
      if (end < 0) throw new Error("HTML_PREVIEW_CSS_URL_INVALID");
      output += value.slice(index, end + 2); index = end + 2; continue;
    }
    if ((index === 0 || !/[\w-]/.test(value[index - 1]!)) && /^url\s*\(/i.test(value.slice(index))) {
      const match = /^url\(\s*(?:"([^"\r\n\\]*)"|'([^'\r\n\\]*)'|([^\s()'"\r\n\\]+))\s*\)/i.exec(value.slice(index));
      if (!match) throw new Error("HTML_PREVIEW_CSS_URL_INVALID");
      const reference = match[1] ?? match[2] ?? match[3]!;
      output += fragment.test(reference) ? match[0] : `url(${JSON.stringify(bind(reference))})`;
      index += match[0].length; continue;
    }
    output += character; index++;
  }
  return output;
}

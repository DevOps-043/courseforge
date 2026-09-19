/** Numbering belongs to the viewer; older/generated titles may already include it. */
export function getModuleTitle(title: string): string {
  return title.replace(/^(?:\s*m[oó]dulo\s+\d+\s*[:.\-–—]\s*)+/iu, "").trim();
}

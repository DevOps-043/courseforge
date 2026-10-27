/** Para documentos HTML generados fuera de React; nunca interpolar la marca sin escapar. */
export function escapeBrandingHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

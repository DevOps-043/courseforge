/** Se aplica después de normalizar el path y autorizar el componente en servidor. */
export function isSlideHtmlSourceOwnedByComponent(storagePath: string, componentId: string): boolean {
  return storagePath.toLowerCase().startsWith(`slides/${componentId.toLowerCase()}-`);
}

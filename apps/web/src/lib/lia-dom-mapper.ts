// DOM Mapper - Escanea automáticamente los elementos interactivos de la página

export interface DOMElement {
  id: string;
  tag: string;
  text: string;
  type?: string;
  href?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isVisible: boolean;
  ariaLabel?: string;
  dataTestId?: string;
}

export interface DOMMap {
  url: string;
  title: string;
  elements: DOMElement[];
  timestamp: string;
}

// Obtener el centro de un elemento
function getElementCenter(rect: DOMRect): { x: number; y: number } {
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2)
  };
}

// Verificar si un elemento es visible
function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

// Obtener texto legible de un elemento
function getElementText(element: Element): string {
  // Primero intentar aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Luego title
  const title = element.getAttribute('title');
  if (title) return title;

  // Luego textContent (limitado)
  const text = element.textContent?.trim().slice(0, 50) || '';
  return text;
}

// Escanear el DOM y encontrar elementos interactivos
export function scanDOM(): DOMMap {
  const elements: DOMElement[] = [];

  // Selectores de elementos interactivos
  const selectors = [
    'a[href]',                    // Links
    'button',                     // Botones
    'input',                      // Inputs
    'textarea',                   // Textareas
    'select',                     // Selects
    '[role="button"]',            // Role button
    '[role="link"]',              // Role link
    '[role="menuitem"]',          // Menu items
    '[role="tab"]',               // Tabs
    '[onclick]',                  // Elementos con onclick
    '[data-lia-action]',          // Elementos marcados para Lia
    '[data-testid]',              // Test IDs
    'nav a',                      // Links de navegación
    'aside a',                    // Links del sidebar
    '.sidebar a',                 // Links del sidebar (clase)
    '[class*="menu"] a',          // Links en menús
    '[class*="nav"] a',           // Links en navegación
  ];

  const allElements = document.querySelectorAll(selectors.join(', '));

  let elementId = 0;
  allElements.forEach((element) => {
    if (!isElementVisible(element)) return;

    const rect = element.getBoundingClientRect();
    const center = getElementCenter(rect);
    const text = getElementText(element);

    // Solo incluir elementos con texto o identificador
    if (!text && !element.id && !element.getAttribute('data-testid')) return;

    elements.push({
      id: `el_${elementId++}`,
      tag: element.tagName.toLowerCase(),
      text: text,
      type: (element as HTMLInputElement).type || undefined,
      href: (element as HTMLAnchorElement).href || undefined,
      x: center.x,
      y: center.y,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      isVisible: true,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      dataTestId: element.getAttribute('data-testid') || undefined,
    });
  });

  // Ordenar por posición (arriba a abajo, izquierda a derecha)
  elements.sort((a, b) => {
    if (Math.abs(a.y - b.y) < 20) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  return {
    url: window.location.href,
    title: document.title,
    elements: elements,
    timestamp: new Date().toISOString()
  };
}

// Generar un resumen legible del mapa para el modelo
export function generateDOMSummary(map: DOMMap): string {
  if (map.elements.length === 0) {
    return 'No se encontraron elementos interactivos en la página.';
  }

  let summary = `## Elementos Interactivos Detectados\n\n`;
  summary += `Página: ${map.title}\n`;
  summary += `URL: ${map.url}\n\n`;
  summary += `### Lista de Elementos (${map.elements.length} encontrados):\n\n`;

  // Agrupar por tipo/ubicación
  const sidebar = map.elements.filter(el => el.x < 250);
  const main = map.elements.filter(el => el.x >= 250);

  if (sidebar.length > 0) {
    summary += `**Menú Lateral (izquierda):**\n`;
    sidebar.forEach(el => {
      summary += `- "${el.text}" → click en x=${el.x}, y=${el.y}\n`;
    });
    summary += '\n';
  }

  if (main.length > 0) {
    summary += `**Área Principal:**\n`;
    main.slice(0, 20).forEach(el => { // Limitar a 20 elementos
      const label = el.text || el.ariaLabel || el.dataTestId || el.tag;
      summary += `- "${label}" (${el.tag}) → click en x=${el.x}, y=${el.y}\n`;
    });
  }

  return summary;
}

// Encontrar un elemento por texto
export function findElementByText(map: DOMMap, searchText: string): DOMElement | null {
  const lower = searchText.toLowerCase();
  return map.elements.find(el =>
    el.text.toLowerCase().includes(lower) ||
    el.ariaLabel?.toLowerCase().includes(lower) ||
    el.dataTestId?.toLowerCase().includes(lower)
  ) || null;
}

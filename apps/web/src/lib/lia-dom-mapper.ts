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
  // Para inputs y textareas, usar placeholder o name
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const placeholder = input.placeholder;
    if (placeholder) return `[Campo: ${placeholder}]`;
    const name = input.name || input.id;
    if (name) return `[Campo: ${name}]`;
    return `[Campo de texto]`;
  }

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
    '[role="option"]',            // Opciones de menú
    '[role="tab"]',               // Tabs
    '[role="switch"]',            // Switches/toggles
    '[onclick]',                  // Elementos con onclick
    '[data-lia-action]',          // Elementos marcados para Lia
    '[data-testid]',              // Test IDs
    'nav a',                      // Links de navegación
    'aside a',                    // Links del sidebar
    '.sidebar a',                 // Links del sidebar (clase)
    '[class*="menu"] a',          // Links en menús
    '[class*="menu"] button',     // Botones en menús
    '[class*="menu"] div[role]',  // Divs con role en menús
    '[class*="dropdown"] a',      // Links en dropdowns
    '[class*="dropdown"] button', // Botones en dropdowns
    '[class*="popover"] a',       // Links en popovers
    '[class*="popover"] button',  // Botones en popovers
    '[class*="nav"] a',           // Links en navegación
    // User menu specific
    '[class*="user"] button',     // Botones de usuario
    '[class*="avatar"]',          // Avatares clickeables
    '[class*="profile"]',         // Elementos de perfil
    '[class*="account"]',         // Elementos de cuenta
    // Theme toggles
    '[class*="theme"]',           // Elementos de tema
    '[class*="dark"]',            // Elementos dark mode
    '[class*="light"]',           // Elementos light mode
    // Spans and divs that might be clickable
    'span[onclick]',
    'div[onclick]',
    'li[onclick]',
    // Lucide icons in buttons (common in this app)
    'button svg',
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

// Detect if page has more content below
function detectScrollableContent(): { hasMoreBelow: boolean; hasMoreAbove: boolean; scrollPosition: string } {
  const mainContent = document.querySelector('main') || document.querySelector('[role="main"]') || document.documentElement;
  const scrollTop = mainContent.scrollTop || window.scrollY;
  const scrollHeight = mainContent.scrollHeight || document.documentElement.scrollHeight;
  const clientHeight = mainContent.clientHeight || window.innerHeight;

  const hasMoreBelow = scrollTop + clientHeight < scrollHeight - 50;
  const hasMoreAbove = scrollTop > 50;

  let scrollPosition = 'inicio';
  if (hasMoreAbove && hasMoreBelow) {
    scrollPosition = 'medio';
  } else if (hasMoreAbove) {
    scrollPosition = 'final';
  }

  return { hasMoreBelow, hasMoreAbove, scrollPosition };
}

// Generar un resumen legible del mapa para el modelo
export function generateDOMSummary(map: DOMMap): string {
  if (map.elements.length === 0) {
    return 'No se encontraron elementos interactivos en la página.';
  }

  // Detect scroll state
  const scrollState = detectScrollableContent();

  let summary = `## Elementos Interactivos Detectados\n\n`;
  summary += `Página: ${map.title}\n`;
  summary += `URL: ${map.url}\n`;

  // Add scroll indicator
  if (scrollState.hasMoreBelow || scrollState.hasMoreAbove) {
    summary += `\n### ESTADO DE SCROLL\n`;
    summary += `- Posición actual: ${scrollState.scrollPosition} de la página\n`;
    if (scrollState.hasMoreBelow) {
      summary += `- ⬇️ HAY MÁS CONTENIDO ABAJO - usa scroll(direction: "down") para ver más\n`;
    }
    if (scrollState.hasMoreAbove) {
      summary += `- ⬆️ HAY CONTENIDO ARRIBA - usa scroll(direction: "up") para volver\n`;
    }
  }
  summary += '\n';

  // Separar campos de texto de otros elementos
  const inputFields = map.elements.filter(el => el.tag === 'input' || el.tag === 'textarea');
  const otherElements = map.elements.filter(el => el.tag !== 'input' && el.tag !== 'textarea');

  // Mostrar campos de texto primero (importante para escribir)
  if (inputFields.length > 0) {
    summary += `### CAMPOS DE TEXTO (para escribir usa type_at):\n`;
    inputFields.forEach(el => {
      summary += `- ${el.text} → type_at x=${el.x}, y=${el.y}\n`;
    });
    summary += '\n';
  }

  // Agrupar otros por ubicación
  const sidebar = otherElements.filter(el => el.x < 250);
  const main = otherElements.filter(el => el.x >= 250);

  if (sidebar.length > 0) {
    summary += `### Menú Lateral:\n`;
    sidebar.forEach(el => {
      summary += `- "${el.text}" → click_at x=${el.x}, y=${el.y}\n`;
    });
    summary += '\n';
  }

  // Separar botones de acción importantes (Generar, Crear, Guardar, etc.)
  const actionKeywords = ['generar', 'crear', 'guardar', 'enviar', 'submit', 'nuevo', 'añadir', 'agregar', 'confirmar', 'aceptar'];
  const actionButtons = main.filter(el => {
    const text = (el.text || el.ariaLabel || '').toLowerCase();
    return el.tag === 'button' && actionKeywords.some(keyword => text.includes(keyword));
  });

  const otherMain = main.filter(el => !actionButtons.includes(el));

  // Mostrar SIEMPRE los botones de acción importantes primero
  if (actionButtons.length > 0) {
    summary += `### BOTONES DE ACCIÓN (IMPORTANTES):\n`;
    actionButtons.forEach(el => {
      const label = el.text || el.ariaLabel || el.dataTestId || el.tag;
      summary += `- "${label}" (button) → click_at x=${el.x}, y=${el.y}\n`;
    });
    summary += '\n';
  }

  if (otherMain.length > 0) {
    summary += `### Área Principal:\n`;
    otherMain.slice(0, 25).forEach(el => {
      const label = el.text || el.ariaLabel || el.dataTestId || el.tag;
      summary += `- "${label}" (${el.tag}) → click_at x=${el.x}, y=${el.y}\n`;
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

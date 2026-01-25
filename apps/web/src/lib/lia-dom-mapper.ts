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
    // Stepper/Wizard steps (important for artifact phases)
    '[class*="stepper"]',         // Stepper containers
    '[class*="step"]',            // Step elements
    '[class*="wizard"]',          // Wizard elements
    '[class*="phase"]',           // Phase elements
    '[data-state]',               // Elements with state (often steppers)
    '[aria-current="step"]',      // Current step indicator
    '.step',                      // Generic step class
    '.stepper-item',              // Stepper items
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
  // Try to find the main scrollable container
  // Check multiple potential scrollable containers
  const scrollableSelectors = [
    'main',
    '[role="main"]',
    '.main-content',
    '.content',
    '[class*="content"]',
    '[class*="scroll"]',
    '[class*="container"]',
    '[style*="overflow"]'
  ];

  let scrollableContainer: Element | null = null;
  let maxScrollHeight = 0;

  // Find the container with the most scrollable content
  for (const selector of scrollableSelectors) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      const htmlEl = el as HTMLElement;
      if (htmlEl.scrollHeight > htmlEl.clientHeight && htmlEl.scrollHeight > maxScrollHeight) {
        maxScrollHeight = htmlEl.scrollHeight;
        scrollableContainer = el;
      }
    });
  }

  // Also check if the document body or html element is scrollable
  const docScrollHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );
  const docClientHeight = window.innerHeight;
  const docScrollTop = window.scrollY || document.documentElement.scrollTop;

  // Use whichever has more scroll potential
  let scrollTop: number;
  let scrollHeight: number;
  let clientHeight: number;

  if (scrollableContainer && maxScrollHeight > docScrollHeight) {
    const container = scrollableContainer as HTMLElement;
    scrollTop = container.scrollTop;
    scrollHeight = container.scrollHeight;
    clientHeight = container.clientHeight;
  } else {
    scrollTop = docScrollTop;
    scrollHeight = docScrollHeight;
    clientHeight = docClientHeight;
  }

  // Use a smaller threshold for detection (20px instead of 50px)
  const hasMoreBelow = scrollTop + clientHeight < scrollHeight - 20;
  const hasMoreAbove = scrollTop > 20;

  let scrollPosition = 'inicio';
  if (hasMoreAbove && hasMoreBelow) {
    scrollPosition = 'medio';
  } else if (hasMoreAbove) {
    scrollPosition = 'final';
  }

  console.log('[DOM Mapper] Scroll detection:', {
    scrollTop,
    scrollHeight,
    clientHeight,
    hasMoreBelow,
    hasMoreAbove,
    container: scrollableContainer?.className || 'document'
  });

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

  // ALWAYS add scroll indicator section to help model decide
  summary += `\n### ESTADO DE SCROLL\n`;
  summary += `- Posición actual: ${scrollState.scrollPosition} de la página\n`;
  if (scrollState.hasMoreBelow) {
    summary += `- ⬇️ **HAY MÁS CONTENIDO ABAJO** - usa scroll(direction: "down") para ver más elementos\n`;
  }
  if (scrollState.hasMoreAbove) {
    summary += `- ⬆️ HAY CONTENIDO ARRIBA - usa scroll(direction: "up") para volver\n`;
  }
  if (!scrollState.hasMoreBelow && !scrollState.hasMoreAbove) {
    summary += `- ✓ No hay más contenido para scroll (estás viendo toda la página)\n`;
  }
  summary += '\n';

  // Separar campos de texto de otros elementos
  const inputFields = map.elements.filter(el => el.tag === 'input' || el.tag === 'textarea');
  const otherElements = map.elements.filter(el => el.tag !== 'input' && el.tag !== 'textarea');

  // Detectar pasos del wizard/stepper (BASE, TEMARIO, PLAN, FUENTES, MATERIALES, SLIDES)
  const wizardStepNames = ['base', 'temario', 'plan', 'fuentes', 'materiales', 'slides', 'validación', 'idea central'];
  const wizardSteps = otherElements.filter(el => {
    const text = (el.text || '').toLowerCase().trim();
    // Only match if the text IS the step name (exact or very close), not just contains it
    // This avoids picking up container elements with concatenated text like "BaseTemarioPlanFuentes..."
    const isExactMatch = wizardStepNames.some(step => text === step);
    const isCloseMatch = wizardStepNames.some(step => text.startsWith(step) && text.length < step.length + 5);
    return isExactMatch || isCloseMatch;
  });

  // Deduplicate wizard steps by text (keep only one entry per step name)
  const seenSteps = new Set<string>();
  const uniqueWizardSteps = wizardSteps.filter(el => {
    const text = (el.text || '').toLowerCase().trim();
    if (seenSteps.has(text)) return false;
    seenSteps.add(text);
    return true;
  });

  // Mostrar pasos del wizard si existen (IMPORTANTE para navegación de artefactos)
  if (uniqueWizardSteps.length > 0) {
    summary += `### PASOS/FASES DEL ARTEFACTO (wizard de creación):\n`;
    summary += `NOTA: Cuando el usuario dice "ve a base", "llévame a temario", "fase plan", etc., se refiere a estos pasos.\n`;
    uniqueWizardSteps.forEach(el => {
      const label = el.text || el.ariaLabel || el.dataTestId || 'paso';
      summary += `- "${label}" (PASO) → click_at x=${el.x}, y=${el.y}\n`;
    });
    summary += '\n';
  }

  // Mostrar campos de texto (importante para escribir)
  if (inputFields.length > 0) {
    summary += `### CAMPOS DE TEXTO (para escribir usa type_at):\n`;
    inputFields.forEach(el => {
      summary += `- ${el.text} → type_at x=${el.x}, y=${el.y}\n`;
    });
    summary += '\n';
  }

  // Agrupar otros por ubicación (excluir los pasos del wizard ya mostrados)
  const nonWizardElements = otherElements.filter(el => !wizardSteps.includes(el));
  const sidebar = nonWizardElements.filter(el => el.x < 250);
  const main = nonWizardElements.filter(el => el.x >= 250);

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

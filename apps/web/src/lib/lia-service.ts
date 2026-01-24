import axios from 'axios';

export interface LiaMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  sources?: { title: string; url: string }[];
}

export interface LiaAction {
  name: string;
  args: any;
}

export interface LiaRequest {
  messages: LiaMessage[];
  screenshot?: string; // Base64
  url?: string;
  computerUseMode?: boolean;
  actionResult?: string;
  domMap?: string; // DOM map summary for automatic element detection
}

export interface LiaResponse {
  message: LiaMessage;
  action?: LiaAction;
  actions?: LiaAction[]; // Support for multiple sequential actions
  requiresFollowUp?: boolean;
  groundingMetadata?: any;
}

// Execute Computer Use actions on the page
export const executeAction = async (action: LiaAction): Promise<string> => {
  const { name, args } = action;

  try {
    switch (name) {
      case 'click_at': {
        const { x, y } = args;
        const element = document.elementFromPoint(x, y) as HTMLElement;
        if (element) {
          // Visual feedback
          showClickFeedback(x, y);

          // Execute click
          element.click();

          // If it's a link, let it navigate
          if (element.tagName === 'A' || element.closest('a')) {
            return `Clic ejecutado en (${x}, ${y}) - Navegando...`;
          }

          return `Clic ejecutado en (${x}, ${y}) sobre elemento: ${element.tagName.toLowerCase()}`;
        }
        return `No se encontró elemento en (${x}, ${y})`;
      }

      case 'type_text': {
        const { text } = args;
        const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement;

        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            // Robustly set value for React
            const prototype = activeElement.tagName === 'INPUT' 
                ? window.HTMLInputElement.prototype 
                : window.HTMLTextAreaElement.prototype;
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            
            if (nativeInputValueSetter) {
                const currentValue = activeElement.value;
                nativeInputValueSetter.call(activeElement, currentValue + text);
            } else {
                activeElement.value += text;
            }

            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            activeElement.dispatchEvent(new Event('change', { bubbles: true }));
            return `Texto escrito: "${text}"`;
        }
        return 'No hay campo de texto activo para escribir';
      }

      case 'type_at': {
        // Combined action: click on field + type text
        const { x, y, text } = args;
        const element = document.elementFromPoint(x, y) as HTMLElement;

        if (element) {
          // Visual feedback
          showClickFeedback(x, y);

          // Focus the element
          element.focus();
          element.click();

          // Small delay to ensure focus
          await new Promise(resolve => setTimeout(resolve, 100));

          let targetInput = element as HTMLInputElement | HTMLTextAreaElement;

          // Check if it's an input or textarea
          if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA') {
            const nestedInput = element.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement;
            if (nestedInput) {
                targetInput = nestedInput;
                targetInput.focus();
            } else {
                return `No se encontró campo de texto en (${x}, ${y})`;
            }
          }

          // Robustly set value for React
          const prototype = targetInput.tagName === 'INPUT' 
              ? window.HTMLInputElement.prototype 
              : window.HTMLTextAreaElement.prototype;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

          if (nativeInputValueSetter) {
              nativeInputValueSetter.call(targetInput, text);
          } else {
              targetInput.value = text;
          }
          
          // Dispatch events to trigger React/form handlers
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.dispatchEvent(new Event('change', { bubbles: true }));
          
          return `Texto "${text}" escrito en el campo`;
        }
        return `No se encontró campo de texto en (${x}, ${y})`;
      }

      case 'scroll': {
        const { direction, amount = 400 } = args;
        const scrollAmount = direction === 'up' ? -amount : amount;

        // Try to scroll the main content area first, then fallback to window
        const mainContent = document.querySelector('main') || document.querySelector('[role="main"]');
        if (mainContent) {
          mainContent.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        }

        // Show visual feedback for scroll
        showScrollFeedback(direction);

        return `Scroll ${direction} ejecutado (${Math.abs(scrollAmount)}px)`;
      }

      case 'scroll_to_element': {
        // Scroll to bring a specific element into view
        const { x, y } = args;
        const element = document.elementFromPoint(x, y) as HTMLElement;
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return `Scroll hacia elemento en (${x}, ${y})`;
        }
        return `No se encontró elemento en (${x}, ${y}) para scroll`;
      }

      case 'scroll_to_bottom': {
        // Scroll to the bottom of the page/container
        const mainContent = document.querySelector('main') || document.querySelector('[role="main"]');
        if (mainContent) {
          mainContent.scrollTo({ top: mainContent.scrollHeight, behavior: 'smooth' });
        } else {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
        showScrollFeedback('down');
        return 'Scroll al final de la página';
      }

      case 'scroll_to_top': {
        // Scroll to the top of the page/container
        const mainContent = document.querySelector('main') || document.querySelector('[role="main"]');
        if (mainContent) {
          mainContent.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        showScrollFeedback('up');
        return 'Scroll al inicio de la página';
      }

      case 'key_press': {
        const { key } = args;
        const event = new KeyboardEvent('keydown', { key, bubbles: true });
        document.dispatchEvent(event);
        return `Tecla presionada: ${key}`;
      }

      case 'mouse_move': {
        const { x, y } = args;
        // Simular hover mostrando feedback visual
        showClickFeedback(x, y, 'move');
        const element = document.elementFromPoint(x, y) as HTMLElement;
        if (element) {
          element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }
        return `Mouse movido a (${x}, ${y})`;
      }

      default:
        return `Acción no reconocida: ${name}`;
    }
  } catch (error) {
    return `Error ejecutando ${name}: ${error}`;
  }
};

// Execute multiple actions sequentially with delays
export const executeActions = async (actions: LiaAction[]): Promise<string[]> => {
  const results: string[] = [];

  for (const action of actions) {
    // Execute action
    const result = await executeAction(action);
    results.push(result);

    // Wait between actions to allow UI to update
    // Longer wait for navigation actions
    const delay = action.name === 'click_at' ? 800 : 400;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  return results;
};

// Show visual feedback for clicks
const showClickFeedback = (x: number, y: number, type: 'click' | 'move' = 'click') => {
  const feedback = document.createElement('div');
  feedback.style.cssText = `
    position: fixed;
    left: ${x - 15}px;
    top: ${y - 15}px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 3px solid ${type === 'click' ? '#1F5AF6' : '#00D4B3'};
    background: ${type === 'click' ? 'rgba(31, 90, 246, 0.3)' : 'rgba(0, 212, 179, 0.3)'};
    pointer-events: none;
    z-index: 999999;
    animation: lia-click-pulse 0.5s ease-out forwards;
  `;

  // Add animation styles if not exists
  if (!document.getElementById('lia-click-styles')) {
    const style = document.createElement('style');
    style.id = 'lia-click-styles';
    style.textContent = `
      @keyframes lia-click-pulse {
        0% { transform: scale(1); opacity: 1; }
        100% { transform: scale(2); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(feedback);
  setTimeout(() => feedback.remove(), 500);
};

// Show visual feedback for scroll
const showScrollFeedback = (direction: string) => {
  const feedback = document.createElement('div');
  const isUp = direction === 'up';

  feedback.innerHTML = isUp ? '↑' : '↓';
  feedback.style.cssText = `
    position: fixed;
    right: 20px;
    ${isUp ? 'top: 20px' : 'bottom: 20px'};
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: rgba(0, 212, 179, 0.9);
    color: white;
    font-size: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 999999;
    animation: lia-scroll-fade 0.8s ease-out forwards;
    box-shadow: 0 4px 12px rgba(0, 212, 179, 0.4);
  `;

  // Add animation styles if not exists
  if (!document.getElementById('lia-scroll-styles')) {
    const style = document.createElement('style');
    style.id = 'lia-scroll-styles';
    style.textContent = `
      @keyframes lia-scroll-fade {
        0% { opacity: 1; transform: translateY(0); }
        100% { opacity: 0; transform: translateY(${isUp ? '-20px' : '20px'}); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(feedback);
  setTimeout(() => feedback.remove(), 800);
};

export const liaService = {
  sendMessage: async (request: LiaRequest): Promise<LiaResponse> => {
    try {
      const response = await axios.post('/api/lia', request);
      return response.data;
    } catch (error) {
      console.error('Error sending message to Lia:', error);
      throw error;
    }
  }
};

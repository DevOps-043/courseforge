import axios from 'axios';

export interface LiaMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: string;
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
  requiresFollowUp?: boolean;
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
          activeElement.value += text;
          activeElement.dispatchEvent(new Event('input', { bubbles: true }));
          return `Texto escrito: "${text}"`;
        }
        return 'No hay campo de texto activo para escribir';
      }

      case 'scroll': {
        const { direction, amount = 300 } = args;
        const scrollAmount = direction === 'up' ? -amount : amount;
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        return `Scroll ${direction} ejecutado`;
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

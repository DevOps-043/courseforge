import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, X, Monitor, Zap } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { liaService, LiaMessage, executeAction } from '@/lib/lia-service';
import { cn } from '@/lib/utils';
import { toJpeg } from 'html-to-image';
import { scanDOM, generateDOMSummary } from '@/lib/lia-dom-mapper';

interface ChatWindowProps {
  onClose: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<LiaMessage[]>([
    {
      role: 'model',
      content: 'Hola, soy Lia. ¿En qué puedo ayudarte hoy? Puedo ver tu pantalla y ejecutar acciones para ayudarte a navegar.',
      timestamp: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [computerUseMode, setComputerUseMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Capture screenshot of the page
  const captureScreenshot = async (): Promise<string | undefined> => {
    try {
      const dataUrl = await toJpeg(document.body, {
        quality: 0.6,
        filter: (node) => node.id !== 'lia-chat-container',
        skipAutoScale: true
      });
      return dataUrl.split(',')[1];
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      return undefined;
    }
  };

  const handleSend = async (actionResult?: string) => {
    if ((!input.trim() && !actionResult) || isLoading) return;

    const userMessage: LiaMessage = actionResult
      ? { role: 'user', content: `[Resultado de acción] ${actionResult}`, timestamp: new Date().toISOString() }
      : { role: 'user', content: input, timestamp: new Date().toISOString() };

    if (!actionResult) {
      setMessages(prev => [...prev, userMessage]);
      setInput('');
    }

    setIsLoading(true);

    try {
      // When computer use mode is active, capture screenshot AND scan DOM
      let screenshotBase64: string | undefined;
      let domMapSummary: string | undefined;

      if (computerUseMode) {
        // Scan DOM to get interactive elements with their coordinates
        const domMap = scanDOM();
        domMapSummary = generateDOMSummary(domMap);
        console.log('DOM Map:', domMapSummary);

        // Capture screenshot
        screenshotBase64 = await captureScreenshot();
      }

      const response = await liaService.sendMessage({
        messages: actionResult ? messages : [...messages, userMessage],
        screenshot: screenshotBase64,
        url: window.location.href,
        computerUseMode: computerUseMode,
        actionResult: actionResult,
        domMap: domMapSummary
      });

      // Add model response
      setMessages(prev => [...prev, response.message]);

      // Handle action if present (execute silently, NO follow-up to avoid loops)
      if (response.action && computerUseMode) {
        // Wait a moment for UI to update
        await new Promise(resolve => setTimeout(resolve, 500));

        // Execute the action silently - NO recursive calls
        await executeAction(response.action);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [...prev, {
        role: 'model',
        content: 'Lo siento, tuve un problema al procesar tu solicitud. ¿Podrías intentarlo de nuevo?',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      id="lia-chat-container"
      className="flex flex-col h-[600px] w-[400px] bg-white dark:bg-[#0A0D12] rounded-2xl shadow-2xl border border-gray-100 dark:border-[#6C757D]/10 overflow-hidden font-sans animation-fade-in-up"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-[#6C757D]/10 bg-white/50 dark:bg-[#0A0D12]/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1F5AF6] to-[#0A2540] flex items-center justify-center text-white font-bold shadow-lg shadow-[#1F5AF6]/20">
            L
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Lia AI Agent</h3>
            <p className="text-[10px] text-gray-400 font-medium">
              {computerUseMode ? '🖥️ Modo Control Activo' : 'Powered by Gemini 2.0'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full text-gray-400 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#F8FAFC] dark:bg-[#0A0D12]">
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} role={msg.role} content={msg.content} />
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[#0A2540]/5 dark:bg-[#00D4B3]/5 px-4 py-3 rounded-2xl rounded-tl-none">
              <Loader2 className="w-5 h-5 animate-spin text-[#1F5AF6] dark:text-[#00D4B3]" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-[#0A0D12] border-t border-gray-100 dark:border-[#6C757D]/10">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={computerUseMode ? "Dime qué hacer en la pantalla..." : "Pregunta algo sobre esta página..."}
            className="w-full resize-none rounded-xl bg-gray-50 dark:bg-[#1E2329] border-0 p-3 pr-12 text-sm focus:ring-2 focus:ring-[#1F5AF6] dark:focus:ring-[#00D4B3] dark:text-white placeholder:text-gray-400 scrollbar-hide"
            rows={2}
          />
          <button
            onClick={() => handleSend()}
            disabled={isLoading || !input.trim()}
            className="absolute right-2 bottom-2 p-2 bg-[#0A2540] dark:bg-[#00D4B3] text-white dark:text-[#0A0D12] rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity shadow-lg shadow-[#0A2540]/20 dark:shadow-[#00D4B3]/20"
          >
            <Send size={16} />
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button
            onClick={() => setComputerUseMode(!computerUseMode)}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors",
              computerUseMode
                ? "bg-gradient-to-r from-[#1F5AF6]/20 to-[#00D4B3]/20 text-[#1F5AF6] dark:text-[#00D4B3] border border-[#1F5AF6]/30"
                : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            )}
          >
            {computerUseMode ? <Zap size={14} /> : <Monitor size={14} />}
            {computerUseMode ? 'Control Activo' : 'Activar Control'}
          </button>
          <p className="text-[10px] text-gray-300 text-right">
            {computerUseMode ? 'Lia puede controlar tu pantalla' : 'Lia puede cometer errores.'}
          </p>
        </div>
      </div>
    </div>
  );
};

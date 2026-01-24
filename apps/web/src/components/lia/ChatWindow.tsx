import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Send, Loader2, X, Monitor, Zap, Mic, Trash2 } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { liaService, LiaMessage, executeAction, executeActions } from '@/lib/lia-service';
import { cn } from '@/lib/utils';
import { toJpeg } from 'html-to-image';
import { scanDOM, generateDOMSummary } from '@/lib/lia-dom-mapper';

interface ChatWindowProps {
  onClose: () => void;
}

// Function to detect if message requires screen control (action intent)
const detectActionIntent = (message: string): boolean => {
  const lowerMessage = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Action verbs that indicate the user wants Lia to DO something on the screen
  const actionPatterns = [
    // Creation verbs
    /\b(crea|creame|crear|crealo|creala|creeme)\b/,
    /\b(genera|generar|generame|generalo)\b/,
    /\b(haz|hazme|hacer|hazlo|hazla)\b/,

    // Navigation verbs
    /\b(ve a|ir a|vamos a|llevame|lleva|navega|abre|abrir|abreme)\b/,
    /\b(muestrame|muestra|ensenami|ensena)\b/,

    // Writing/form verbs
    /\b(escribe|escribir|escribeme|rellena|rellenar|completa|completar|llena|llenar)\b/,
    /\b(pon|poner|ponme|agrega|agregar|anade|anadir)\b/,

    // Click verbs
    /\b(pulsa|presiona|clica|clickea|haz clic|dale clic)\b/,
    /\b(selecciona|seleccionar|elige|elegir|marca|marcar)\b/,

    // Change/toggle verbs
    /\b(cambia|cambiar|cambiame|cambialo|cambiala)\b/,
    /\b(activa|activar|activame|activalo)\b/,
    /\b(desactiva|desactivar|desactivame|desactivalo)\b/,
    /\b(configura|configurar|configurame|ajusta|ajustar)\b/,
    /\b(modifica|modificar|modificame|altera|alterar)\b/,
    /\b(actualiza|actualizar|actualizame)\b/,

    // Mode/theme related
    /\b(modo oscuro|modo claro|modo dark|modo light|dark mode|light mode)\b/,
    /\b(tema oscuro|tema claro|tema dark|tema light)\b/,
    /\b(pon oscuro|pon claro|ponlo oscuro|ponlo claro)\b/,

    // Specific action phrases
    /\b(nuevo artefacto|nueva cuenta|nuevo usuario|nuevo curso)\b/,
    /\b(con la informacion|con los datos|con el contenido)\b/,
    /\b(basado en|usando la|utiliza la|con lo que)\b/,

    // Artifact/element search patterns (critical for scroll functionality)
    /\b(abre|busca|encuentra|ve al?) (?:el )?artefacto\b/,
    /\b(?:el|al) artefacto (?:de|del|sobre|llamado)\b/,
    /\b(llevame|lleva|ve) a(?:l)? (?:ultimo|ultima|artefacto)\b/,

    // Direct commands
    /\b(ejecuta|ejecutar|realiza|realizar|inicia|iniciar|comienza|comenzar)\b/,
    /\b(apaga|apagar|enciende|encender|prende|prender)\b/,

    // Scroll/navigation commands
    /\b(baja|bajar|sube|subir|scroll|desplaza|desplazar)\b/,
    /\b(ve abajo|ve arriba|ir abajo|ir arriba)\b/,
    /\b(mas abajo|mas arriba|hacia abajo|hacia arriba)\b/,
    /\b(al final|al inicio|al principio|al fondo)\b/,
  ];

  return actionPatterns.some(pattern => pattern.test(lowerMessage));
};

export const ChatWindow: React.FC<ChatWindowProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<LiaMessage[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('lia_chat_history');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse chat history', e);
        }
      }
    }
    return [
      {
        role: 'model',
        content: 'Hola, soy Lia. ¿En qué puedo ayudarte hoy? Puedo ver tu pantalla y ejecutar acciones para ayudarte a navegar.',
        timestamp: new Date().toISOString()
      }
    ];
  });

  // Save to localStorage whenever messages change
  useEffect(() => {
    localStorage.setItem('lia_chat_history', JSON.stringify(messages));
  }, [messages]);

  // Clear Chat Logic with Timer
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const clearConfirmTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const requestClearChat = () => {
    if (showClearConfirm) return; // Already showing
    
    setShowClearConfirm(true);
    
    // Auto-dismiss after 10 seconds
    if (clearConfirmTimeoutRef.current) clearTimeout(clearConfirmTimeoutRef.current);
    clearConfirmTimeoutRef.current = setTimeout(() => {
        setShowClearConfirm(false);
    }, 10000);
  };

  const confirmClearChat = () => {
    const initialMessage: LiaMessage = {
      role: 'model',
      content: 'Hola, soy Lia. ¿En qué puedo ayudarte hoy? Puedo ver tu pantalla y ejecutar acciones para ayudarte a navegar.',
      timestamp: new Date().toISOString()
    };
    setMessages([initialMessage]);
    localStorage.removeItem('lia_chat_history');
    
    setShowClearConfirm(false);
    if (clearConfirmTimeoutRef.current) clearTimeout(clearConfirmTimeoutRef.current);
  };

  const cancelClearChat = () => {
    setShowClearConfirm(false);
    if (clearConfirmTimeoutRef.current) clearTimeout(clearConfirmTimeoutRef.current);
  };

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isActionMode, setIsActionMode] = useState(false); // Indicates if current request is using screen control
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Dynamic Loading Text
  const [loadingText, setLoadingText] = useState('Pensando...');

  useEffect(() => {
    if (!isLoading) {
        setLoadingText('Pensando...');
        return;
    }

    const messages = [
        'Razonando...',
        'Investigando en la web...',
        'Accediendo a fuentes...',
        'Analizando resultados...',
        'Generando respuesta...'
    ];
    let index = 0;

    const interval = setInterval(() => {
        index = (index + 1) % messages.length;
        setLoadingText(messages[index]);
    }, 2500);

    return () => clearInterval(interval);
  }, [isLoading]);

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

  const handleSend = async (actionResult?: string | null, manualText?: string, forceActionMode?: boolean) => {
    const contentToSend = manualText || input;

    if ((!contentToSend.trim() && !actionResult) || isLoading) return;

    const userMessage: LiaMessage = actionResult
      ? { role: 'user', content: `[Resultado de acción] ${actionResult}`, timestamp: new Date().toISOString() }
      : { role: 'user', content: contentToSend || '', timestamp: new Date().toISOString() };

    if (!actionResult) {
      setMessages(prev => [...prev, userMessage]);
      setInput('');
    }

    // Auto-detect if this message requires screen control
    // forceActionMode is used for continuations
    const useScreenControl = forceActionMode || detectActionIntent(contentToSend);
    setIsActionMode(useScreenControl);
    console.log('=== ACTION DETECTION ===');
    console.log('Message:', contentToSend);
    console.log('Detected action intent:', useScreenControl);

    setIsLoading(true);

    try {
      // When action mode is detected, capture screenshot AND scan DOM
      let screenshotBase64: string | undefined;
      let domMapSummary: string | undefined;

      if (useScreenControl) {
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
        computerUseMode: useScreenControl,
        actionResult: actionResult || undefined,
        domMap: domMapSummary
      });

      // Debug: Log the full response
      console.log('=== LIA RESPONSE RECEIVED ===');
      console.log('Full response:', JSON.stringify(response, null, 2));
      console.log('Message:', response.message?.content);
      console.log('Action:', response.action);
      console.log('Actions:', response.actions);

      // Handle actions if present (when screen control was used)
      if (useScreenControl && (response.action || response.actions)) {
        // Get the original user message for continuations
        const originalUserMessage = contentToSend || messages.filter(m => m.role === 'user').pop()?.content || '';

        // Track all actions performed for the final summary
        const actionsPerformed: string[] = [];

        // Function to execute action and handle continuations recursively
        // maxContinuations increased to 5 to allow multiple scrolls when searching for elements
        const executeWithContinuation = async (
          currentResponse: any,
          currentMessages: LiaMessage[],
          continuationCount: number = 0,
          maxContinuations: number = 5
        ): Promise<string> => {
          const urlBeforeAction = window.location.href;

          // Capture DOM before action to detect dropdown/menu changes
          const domBefore = scanDOM();
          const domSummaryBefore = generateDOMSummary(domBefore);

          // Track the action description
          if (currentResponse.message?.content) {
            actionsPerformed.push(currentResponse.message.content);
          }

          // Execute the action(s)
          if (currentResponse.actions && currentResponse.actions.length > 0) {
            console.log(`Executing multiple actions (continuation ${continuationCount}):`, currentResponse.actions.length);
            await executeActions(currentResponse.actions);
          } else if (currentResponse.action) {
            console.log(`Executing single action (continuation ${continuationCount}):`, currentResponse.action.name);
            await executeAction(currentResponse.action);
          } else {
            console.log('No actions to execute');
            return currentResponse.message?.content || 'Acción completada.';
          }

          // Check if action requires continuation (click, scroll)
          const actionName = currentResponse.action?.name || '';
          const isClickAction = actionName === 'click_at';
          const isScrollAction = actionName.startsWith('scroll');

          if ((isClickAction || isScrollAction) && continuationCount < maxContinuations) {
            // Wait for navigation/animation/scroll to complete
            const waitTime = isScrollAction ? 800 : 1500;
            await new Promise(resolve => setTimeout(resolve, waitTime));

            const urlAfterAction = window.location.href;
            const domAfter = scanDOM();
            const domSummaryAfter = generateDOMSummary(domAfter);

            console.log('URL before:', urlBeforeAction);
            console.log('URL after:', urlAfterAction);

            // Check if DOM changed significantly (new elements appeared, like a dropdown menu)
            const domChanged = domSummaryBefore !== domSummaryAfter;
            const urlChanged = urlAfterAction !== urlBeforeAction;

            console.log('DOM changed:', domChanged);
            console.log('URL changed:', urlChanged);
            console.log('Action was scroll:', isScrollAction);

            // Continue if URL changed OR if DOM changed (dropdown opened) OR after scroll
            if (urlChanged || domChanged || isScrollAction) {
              console.log(`=== ${urlChanged ? 'URL' : isScrollAction ? 'SCROLL' : 'DOM'} CHANGED - AUTO-CONTINUING (${continuationCount + 1}/${maxContinuations}) ===`);

              // Send a continuation request with the new DOM
              const newDomSummary = domSummaryAfter;
              console.log('New DOM Map after action:', newDomSummary);

              // Add a system message to indicate continuation
              let changeType = '';
              let scrollSearchInstruction = '';
              if (urlChanged) {
                changeType = `La página cambió a ${urlAfterAction}`;
              } else if (isScrollAction) {
                changeType = 'Se hizo scroll en la página. NUEVOS ELEMENTOS VISIBLES.';
                // Extract the search term from the original message for more specific instructions
                const searchTermMatch = originalUserMessage.match(/(?:abre|busca|encuentra|ve a|muestra)(?:\s+el)?(?:\s+artefacto)?(?:\s+de)?\s+["']?(\w+)["']?/i);
                const searchTerm = searchTermMatch ? searchTermMatch[1] : '';
                scrollSearchInstruction = searchTerm
                  ? ` BUSCA "${searchTerm}" en el nuevo MAPA DE ELEMENTOS. ` +
                    `SI lo encuentras → click_at en sus coordenadas. ` +
                    `SI NO lo encuentras Y hay "MÁS CONTENIDO ABAJO" → haz OTRO scroll. ` +
                    `RECUERDA: NO hagas click en un artefacto diferente a "${searchTerm}".`
                  : ' BUSCA en el nuevo mapa el elemento que el usuario pidió. Si lo encuentras, haz clic. Si no y hay más contenido, haz otro scroll.';
              } else {
                changeType = 'Se abrió un menú desplegable o aparecieron nuevos elementos';
              }
              const isNearMaxContinuations = continuationCount + 1 >= maxContinuations - 1;
              const continuationMessage = `[CONTINUACIÓN AUTOMÁTICA ${continuationCount + 1}/${maxContinuations}] ${changeType}. El usuario originalmente pidió: "${originalUserMessage}".${scrollSearchInstruction} Revisa el nuevo mapa de elementos y continúa con la siguiente acción necesaria.${isNearMaxContinuations ? ' IMPORTANTE: Si esta es la última acción, tu mensaje DEBE ser un RESUMEN COMPLETO de todo lo que hiciste (el usuario solo verá este mensaje).' : ''}`;

              // Capture new screenshot
              const newScreenshot = await captureScreenshot();

              // Send continuation request
              const continuationResponse = await liaService.sendMessage({
                messages: [...currentMessages, currentResponse.message, { role: 'user', content: continuationMessage, timestamp: new Date().toISOString() }],
                screenshot: newScreenshot,
                url: urlAfterAction,
                computerUseMode: true,
                domMap: newDomSummary
              });

              console.log('Continuation response:', JSON.stringify(continuationResponse, null, 2));

              // DON'T add intermediate messages to chat - continue silently
              // Recursively execute the continuation
              return await executeWithContinuation(
                continuationResponse,
                [...currentMessages, currentResponse.message, { role: 'user', content: continuationMessage, timestamp: new Date().toISOString() }],
                continuationCount + 1,
                maxContinuations
              );
            }
          }

          // Return the last message content
          return currentResponse.message?.content || 'Acción completada.';
        };

        // Wait a moment for UI to update
        await new Promise(resolve => setTimeout(resolve, 500));

        // Execute all actions silently and get the final result
        const finalMessage = await executeWithContinuation(response, [...messages, userMessage]);

        // Only show ONE final summary message
        // The finalMessage should contain the summary from the last step (as instructed in the prompt)
        const summaryMessage: LiaMessage = {
          role: 'model',
          content: finalMessage,
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, summaryMessage]);

      } else {
        // No actions - just add the response message normally
        setMessages(prev => [...prev, response.message]);
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
      setIsActionMode(false); // Reset action mode indicator
    }
  };

  // Speech Recognition Setup
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = false;
            recognitionRef.current.lang = 'es-ES';
        }
    }
  }, []);

  useEffect(() => {
    if (recognitionRef.current) {
        recognitionRef.current.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            setInput(transcript);
            handleSend(null, transcript); // Now calls the fresh handleSend with current state
        };

        recognitionRef.current.onend = () => setIsRecording(false);
        recognitionRef.current.onerror = () => setIsRecording(false);
    }
  }, [handleSend]);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
        alert('Tu navegador no soporta dictado por voz.');
        return;
    }
    if (isRecording) {
        recognitionRef.current.stop();
    } else {
        setInput('');
        recognitionRef.current.start();
        setIsRecording(true);
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
      className="flex flex-col h-[650px] w-[420px] bg-white dark:bg-[#0A0D12] rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden font-sans"
    >
      {/* Premium Header */}
      <div className="bg-[#0A2540] p-4 flex items-center justify-between shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
             <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white font-bold backdrop-blur-sm border border-white/10 overflow-hidden">
                <img src="/lia-avatar.png" alt="Lia" className="w-full h-full object-cover" />
             </div>
             <div className={cn(
               "absolute -bottom-1 -right-1 w-3.5 h-3.5 border-2 border-[#0A2540] rounded-full transition-colors",
               isActionMode ? "bg-[#00D4B3] animate-pulse" : "bg-[#00D4B3]"
             )}></div>
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
                Lia AI
                <span className="text-[10px] px-1.5 py-0.5 bg-[#00D4B3]/20 text-[#00D4B3] rounded border border-[#00D4B3]/30">BETA</span>
            </h3>
            <p className="text-xs text-blue-200/70 font-medium">
              {isActionMode ? 'Ejecutando acciones...' : 'Asistente Inteligente'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
            {/* Action mode indicator (visual only, no toggle) */}
            <div
                className={cn(
                    "p-2 rounded-lg transition-all",
                    isActionMode
                        ? "text-[#00D4B3] bg-[#00D4B3]/10"
                        : "text-blue-200/30"
                )}
                title={isActionMode ? "Modo Acción Activo" : "Modo Conversación"}
            >
                {isActionMode ? <Zap size={18} className="fill-current" /> : <Monitor size={18} />}
            </div>
            <button
                onClick={requestClearChat}
                className={cn(
                    "p-2 rounded-lg transition-colors",
                    showClearConfirm
                        ? "text-red-400 bg-red-500/10"
                        : "text-blue-200/50 hover:text-red-400 hover:bg-white/5"
                )}
                title="Limpiar conversación"
            >
                <Trash2 size={18} />
            </button>
            <button
                onClick={onClose}
                className="p-2 text-blue-200/50 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
                <X size={20} />
            </button>
        </div>
      </div>

      {/* Clear Chat Confirmation Banner */}
      <AnimatePresence>
        {showClearConfirm && (
            <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-[#0A2540] border-t border-white/5 relative overflow-hidden"
            >
                 <div className="p-3 flex items-center justify-between gap-3">
                     <span className="text-xs font-medium text-white/90 truncate">
                        ¿Borrar historial?
                     </span>
                     <div className="flex items-center gap-2 flex-shrink-0">
                         <button 
                            onClick={cancelClearChat}
                            className="text-[10px] font-medium px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                         >
                            Cancelar
                         </button>
                         <button 
                            onClick={confirmClearChat}
                            className="text-[10px] font-medium px-2 py-1 rounded bg-red-500 hover:bg-red-600 text-white transition-colors shadow-sm"
                         >
                            Borrar
                         </button>
                     </div>
                 </div>
                 {/* Timeout Progress Bar */}
                 <motion.div 
                    initial={{ width: '100%' }} 
                    animate={{ width: '0%' }} 
                    transition={{ duration: 10, ease: "linear" }}
                    className="absolute bottom-0 left-0 h-0.5 bg-red-500" 
                 />
            </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-[#F8FAFC] dark:bg-[#0A0D12] scroll-smooth custom-scrollbar">
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} role={msg.role} content={msg.content} sources={msg.sources} />
        ))}
        {isLoading && (
          <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-white dark:bg-[#1E2329] border border-gray-100 dark:border-white/5 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#0A2540] dark:text-[#00D4B3]" />
              <span className="text-xs text-gray-500 dark:text-gray-400">{loadingText}</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 bg-white dark:bg-[#0A0D12] border-t border-gray-100 dark:border-[#6C757D]/10">
        <div 
            className={cn(
                "relative flex items-end gap-1.5 p-1.5 rounded-[26px] bg-gray-50 dark:bg-[#1E2329] border transition-all duration-300",
                isRecording 
                    ? "border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)] bg-red-50/50 dark:bg-red-900/10" 
                    : "border-gray-200 dark:border-white/5 focus-within:border-[#00D4B3] focus-within:ring-1 focus-within:ring-[#00D4B3]/20 shadow-inner"
            )}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? "Escuchando..." : "Dime qué hacer..."}
            className="flex-1 resize-none bg-transparent border-none py-2.5 px-4 text-sm focus:ring-0 focus:outline-none dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 min-h-[40px] max-h-[120px]"
            rows={1}
            style={{ minHeight: '40px' }}
          />
          
          <button
            onClick={() => {
                if (input.trim()) {
                    handleSend();
                } else {
                    toggleRecording();
                }
            }}
            disabled={isLoading && !isRecording}
            className={cn(
                "p-2 rounded-full flex-shrink-0 transition-all shadow-md m-0.5",
                isRecording
                    ? "bg-red-500 text-white animate-pulse hover:bg-red-600"
                    : (input.trim())
                        ? "bg-[#0A2540] hover:bg-[#0A2540]/90 dark:bg-[#00D4B3] dark:text-[#0A0D12] dark:hover:bg-[#00bda0] text-white hover:scale-105 active:scale-95 transform"
                        : "bg-gray-100 dark:bg-white/10 text-gray-400 hover:bg-gray-200 dark:hover:bg-white/20 hover:text-gray-600 dark:hover:text-white"
            )}
            title={input.trim() ? "Enviar mensaje" : (isRecording ? "Detener grabación" : "Dictar por voz")}
          >
            {isLoading && !isRecording ? (
                <Loader2 size={16} className="animate-spin" />
            ) : input.trim() ? (
                <Send size={16} className="ml-0.5" />
            ) : isRecording ? (
                <Loader2 size={16} className="animate-spin" />
            ) : (
                <Mic size={18} />
            )}
          </button>
        </div>
        
        <div className="mt-2 text-center">
             <p className="text-[10px] text-gray-400 dark:text-gray-600">
                {isRecording ? 'Detectando voz... (Puede hablar ahora)' : 'Lia Agent puede cometer errores.'}
             </p>
        </div>
      </div>
    </div>
  );
};

'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
  description?: string;
}

interface PremiumSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  icon?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
}

export function PremiumSelect({ options, value, onChange, label, icon, placeholder = "Seleccionar...", disabled = false }: PremiumSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  
  const selectedOption = options.find(o => o.value === value);

  // Close on click outside and scroll
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      const menu = document.getElementById('premium-select-menu');
      if (menu && menu.contains(target)) return;
      setIsOpen(false);
    }
    


    if (isOpen) {
        document.addEventListener("mousedown", handleClickOutside);
        // Removed scroll listener that was auto-closing the menu
        window.addEventListener("resize", updatePosition); // Update position instead of closing
    }
    return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  const updatePosition = () => {
    if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const MAX_HEIGHT = 300;

        // Decide direction: flip if space below is tight (< 300px) AND there is more space above
        const flip = spaceBelow < MAX_HEIGHT && spaceAbove > spaceBelow;

        const style: React.CSSProperties = {
            left: rect.left,
            width: rect.width,
            position: 'fixed',
            zIndex: 9999,
        };

        if (flip) {
            style.bottom = (viewportHeight - rect.top) + 8; // Anchor to bottom of viewport relative to trigger top
            style.top = 'auto'; 
            style.maxHeight = Math.min(MAX_HEIGHT, spaceAbove - 24); // Cap height to fit above
            style.transformOrigin = 'bottom center';
        } else {
            style.top = rect.bottom + 8;
            style.bottom = 'auto';
            style.maxHeight = Math.min(MAX_HEIGHT, spaceBelow - 24); // Cap height to fit below
            style.transformOrigin = 'top center';
        }

        setMenuStyle(style);
    }
  };

  const handleToggle = () => {
    if (!disabled) {
        if (!isOpen) {
            updatePosition();
            setIsOpen(true);
        } else {
            setIsOpen(false);
        }
    }
  };

  return (
    <div className="space-y-2 relative">
      {label && (
         <label className="text-[10px] font-bold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider flex items-center gap-2">
            {icon}
            {label}
         </label>
      )}
      
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          className={`
            w-full px-4 py-3 rounded-xl border flex items-center justify-between gap-3 transition-all duration-300 outline-none
            bg-white dark:bg-[#0A0D12] text-left group
            ${disabled ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-[#1E2329]' : 
              isOpen 
                ? 'border-[#00D4B3] ring-1 ring-[#00D4B3]/20 shadow-[0_0_15px_rgba(0,212,179,0.1)]' 
                : 'border-gray-200 dark:border-[#1E2329] hover:border-gray-300 dark:hover:border-[#6C757D]/50 hover:bg-gray-50 dark:hover:bg-[#0F1419]'
            }
          `}
        >
          <div className="flex flex-col min-w-0">
              <span className={`text-sm font-medium truncate ${selectedOption ? 'text-gray-900 dark:text-[#E9ECEF]' : 'text-gray-500 dark:text-[#6C757D]'}`}>
                 {selectedOption ? selectedOption.label : placeholder}
              </span>
              {selectedOption?.description && (
                  <span className="text-[10px] text-gray-400 dark:text-[#6C757D] font-mono mt-0.5 truncate uppercase tracking-tight">
                      {selectedOption.description}
                  </span>
              )}
          </div>
          
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className={`shrink-0 opacity-50 group-hover:opacity-100 ${isOpen ? 'text-[#00D4B3]' : 'text-gray-400 dark:text-[#6C757D]'}`}
          >
             <ChevronDown size={16} />
          </motion.div>
        </button>

        {/* PORTAL RENDER */}
        {isOpen && !disabled && (
            <Portal>
                 <AnimatePresence>
                    <motion.div
                      id="premium-select-menu"
                      initial={{ opacity: 0, scale: 0.95, y: menuStyle.bottom ? 10 : -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: menuStyle.bottom ? 10 : -10 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      style={menuStyle}
                      className="rounded-xl border border-gray-200 dark:border-[#1E2329] bg-white dark:bg-[#151A21] shadow-2xl overflow-hidden ring-1 ring-black/5 dark:ring-black/50 flex flex-col"
                    >
                      <div className="p-2 overflow-y-auto custom-scrollbar flex-1 overscroll-contain">
                        {options.map((option) => {
                           const isSelected = option.value === value;
                           return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                   onChange(option.value);
                                   setIsOpen(false);
                                }}
                                className={`
                                   w-full px-3 py-2.5 rounded-lg flex items-center justify-between group transition-colors text-left
                                   ${isSelected ? 'bg-[#00D4B3]/10' : 'hover:bg-gray-50 dark:hover:bg-[#1E2329]'}
                                `}
                              >
                                 <div className="flex flex-col min-w-0">
                                     <span className={`text-sm font-medium truncate ${isSelected ? 'text-[#00D4B3]' : 'text-gray-900 dark:text-[#E9ECEF]'}`}>
                                         {option.label}
                                     </span>
                                     {option.description && (
                                        <span className={`text-[10px] mt-0.5 uppercase tracking-wide truncate ${isSelected ? 'text-[#00D4B3]/70' : 'text-gray-400 dark:text-[#6C757D] group-hover:text-gray-600 dark:group-hover:text-[#94A3B8]'}`}>
                                            {option.description}
                                        </span>
                                     )}
                                 </div>
                                 
                                 {isSelected && (
                                     <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="shrink-0 ml-2">
                                         <Check size={14} className="text-[#00D4B3]" />
                                     </motion.div>
                                 )}
                              </button>
                           );
                        })}
                      </div>
                    </motion.div>
                </AnimatePresence>
            </Portal>
        )}
      </div>
    </div>
  );
}

// Simple Portal Component
function Portal({ children }: { children: React.ReactNode }) {
    if (typeof document === 'undefined') return null;
    return createPortal(children, document.body);
}

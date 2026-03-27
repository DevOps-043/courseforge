"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export const PremiumInput = ({ className, ...props }: any) => (
  <input
    className={`w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 
              text-white placeholder-white/30 focus:outline-none focus:border-[#00D4B3]/50 focus:bg-white/10
              transition-all duration-200 ${className}`}
    {...props}
  />
);

export const PremiumTextarea = ({ className, ...props }: any) => (
  <textarea
    className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 
              text-white placeholder-white/30 focus:outline-none focus:border-[#00D4B3]/50 focus:bg-white/10
              transition-all duration-200 resize-none ${className}`}
    {...props}
  />
);

export const PremiumSelect = ({
  options,
  value,
  onChange,
  placeholder = "Select...",
  className,
}: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel =
    options.find((option: any) => option.value === value)?.label ||
    value ||
    placeholder;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between gap-2 text-xs font-medium text-white hover:border-[#00D4B3]/50 transition-all"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={14}
          className={`text-white/50 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-white/10 bg-[#1E2329] shadow-2xl overflow-hidden z-[50] min-w-[150px]"
          >
            <div className="max-h-[200px] overflow-y-auto py-1">
              {options.map((option: any) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-xs hover:bg-white/5 transition-colors flex items-center justify-between
                            ${option.value === value ? "text-[#00D4B3] bg-[#00D4B3]/10" : "text-gray-300"}
                    `}
                >
                  {option.label}
                  {option.value === value && <Check size={12} />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

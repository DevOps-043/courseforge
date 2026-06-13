"use client";

import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface PremiumOption {
  label: string;
  value: string;
}

interface PremiumSelectProps {
  className?: string;
  onChange: (value: string) => void;
  options: PremiumOption[];
  placeholder?: string;
  value?: string | null;
}

type PremiumInputProps = InputHTMLAttributes<HTMLInputElement>;
type PremiumTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const PremiumInput = ({ className, value, ...props }: PremiumInputProps) => (
  <input
    className={`w-full px-4 py-2.5 rounded-xl bg-white border border-gray-200
              text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#00D4B3]/50 focus:bg-white
              dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 dark:focus:bg-white/10
              transition-all duration-200 ${className}`}
    value={value != null && !Number.isNaN(value) ? value : ""}
    {...props}
  />
);

export const PremiumTextarea = ({
  className,
  value,
  ...props
}: PremiumTextareaProps) => (
  <textarea
    className={`w-full px-4 py-3 rounded-xl bg-white border border-gray-200
              text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#00D4B3]/50 focus:bg-white
              dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 dark:focus:bg-white/10
              transition-all duration-200 resize-none ${className}`}
    value={value != null && !Number.isNaN(value) ? value : ""}
    {...props}
  />
);

export const PremiumSelect = ({
  options,
  value,
  onChange,
  placeholder = "Select...",
  className,
}: PremiumSelectProps) => {
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
    options.find((option) => option.value === value)?.label ||
    value ||
    placeholder;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 flex items-center justify-between gap-2 text-xs font-medium text-gray-900 hover:border-[#00D4B3]/50 transition-all dark:bg-white/5 dark:border-white/10 dark:text-white"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={14}
          className={`text-gray-400 dark:text-white/50 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden z-[50] min-w-[150px] dark:border-white/10 dark:bg-[#1E2329]"
          >
            <div className="max-h-[200px] overflow-y-auto py-1">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-50 transition-colors flex items-center justify-between dark:hover:bg-white/5
                            ${option.value === value ? "text-[#00D4B3] bg-[#00D4B3]/10" : "text-gray-700 dark:text-gray-300"}
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

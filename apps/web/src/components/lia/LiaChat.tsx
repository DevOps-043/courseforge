'use client';

import React, { useState } from 'react';
import { ChatWindow } from './ChatWindow';
import { Sparkles, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

export const LiaChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div 
        id="lia-chat-container" 
        className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4"
    >
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.2 }}
            className="origin-bottom-right"
          >
            <ChatWindow onClose={() => setIsOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
            "h-14 w-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 backdrop-blur-sm",
            isOpen 
                ? "bg-white text-gray-800 dark:bg-[#1E2329] dark:text-gray-200 border border-gray-200 dark:border-gray-700"
                : "bg-gradient-to-br from-[#1F5AF6] to-[#0A2540] text-white border-2 border-white/20 dark:border-[#00D4B3]/20 shadow-[#1F5AF6]/30"
        )}
      >
        {isOpen ? (
            <MessageCircle size={24} />
        ) : (
            <div className="relative w-full h-full overflow-hidden rounded-full">
                <img src="/lia-avatar.png" alt="Lia" className="w-full h-full object-cover" />
                <span className="absolute top-1 right-1 flex h-2.5 w-2.5 z-10">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00D4B3] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00D4B3] border border-[#0A2540]"></span>
                </span>
            </div>
        )}
      </motion.button>
    </div>
  );
};

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { Sparkles, User } from 'lucide-react';

interface ChatMessageProps {
  role: 'user' | 'model';
  content: string;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ role, content }) => {
  const isUser = role === 'user';

  return (
    <div className={cn(
      "flex w-full gap-3 mb-4",
      isUser ? "flex-row-reverse" : "flex-row"
    )}>
      <div className={cn(
        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm",
        isUser 
          ? "bg-[#0A2540] text-white dark:bg-[#00D4B3] dark:text-[#0A0D12]" 
          : "bg-gradient-to-br from-[#1F5AF6] to-[#0A2540] text-white"
      )}>
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>

      <div className={cn(
        "max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-md backdrop-blur-md",
        isUser 
          ? "bg-white/80 dark:bg-[#1E2329]/80 border border-gray-100 dark:border-[#6C757D]/20 text-gray-800 dark:text-gray-200" 
          : "bg-[#0A2540]/5 dark:bg-[#00D4B3]/5 border border-[#1F5AF6]/10 dark:border-[#00D4B3]/20"
      )}>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { ExternalLink, Sparkles, User } from 'lucide-react';

interface ChatMessageProps {
  role: 'user' | 'model';
  content: string;
  sources?: { title: string; url: string }[];
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ role, content, sources }) => {
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
        {isUser ? (
          <User size={14} /> 
        ) : (
          <div className="w-full h-full overflow-hidden rounded-full">
            <img src="/lia-avatar.png" alt="Lia" className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      <div className={cn(
        "max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-md backdrop-blur-md",
        isUser 
          ? "bg-white/80 dark:bg-[#1E2329]/80 border border-gray-100 dark:border-[#6C757D]/20 text-gray-800 dark:text-gray-200" 
          : "bg-[#0A2540]/5 dark:bg-[#00D4B3]/5 border border-[#1F5AF6]/10 dark:border-[#00D4B3]/20"
      )}>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>

        {/* Sources Section */}
        {sources && sources.length > 0 && (
            <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/10">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                    <ExternalLink size={10} /> Fuentes consultadas:
                </p>
                <div className="flex flex-wrap gap-2">
                    {sources.map((source, idx) => {
                        let hostname = '';
                        try {
                            hostname = new URL(source.url).hostname;
                        } catch (e) {
                            hostname = 'google.com';
                        }
                        const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;

                        return (
                            <a 
                                key={idx}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-gray-50 dark:bg-[#151A21] border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-[#1E2329] transition-all text-gray-700 dark:text-gray-300 max-w-full sm:max-w-[220px] group"
                                title={source.title}
                            >
                                <div className="w-4 h-4 rounded-full bg-white p-0.5 shadow-sm flex-shrink-0 flex items-center justify-center overflow-hidden">
                                     <img 
                                        src={faviconUrl} 
                                        alt="" 
                                        className="w-full h-full object-cover" 
                                     />
                                </div>
                                <span className="truncate font-medium group-hover:text-[#0A2540] dark:group-hover:text-white transition-colors">
                                    {source.title}
                                </span>
                            </a>
                        );
                    })}
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

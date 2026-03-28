'use client';

import { useState, type ReactNode } from 'react';
import {
  MaterialComponent,
  ComponentType,
} from '../types/materials.types';
import {
  MessageSquare,
  BookOpen,
  HelpCircle,
  Play,
  ListOrdered,
  ChevronDown,
  ChevronUp,
  FileText,
  MonitorPlay,
} from 'lucide-react';
import { renderComponentContent } from './ComponentContentRenderer';

interface ComponentViewerProps {
  component: MaterialComponent;
  variant?: 'card' | 'embedded';
  className?: string;
}

const COMPONENT_ICONS: Record<ComponentType, ReactNode> = {
  DIALOGUE: <MessageSquare className="h-4 w-4" />,
  READING: <BookOpen className="h-4 w-4" />,
  QUIZ: <HelpCircle className="h-4 w-4" />,
  DEMO_GUIDE: <ListOrdered className="h-4 w-4" />,
  EXERCISE: <FileText className="h-4 w-4" />,
  VIDEO_THEORETICAL: <MonitorPlay className="h-4 w-4" />,
  VIDEO_DEMO: <Play className="h-4 w-4" />,
  VIDEO_GUIDE: <Play className="h-4 w-4" />,
};

const COMPONENT_LABELS: Record<ComponentType, string> = {
  DIALOGUE: 'Diálogo con Lia',
  READING: 'Lectura',
  QUIZ: 'Cuestionario',
  DEMO_GUIDE: 'Guía Demo',
  EXERCISE: 'Ejercicio',
  VIDEO_THEORETICAL: 'Video Teórico',
  VIDEO_DEMO: 'Video Demo',
  VIDEO_GUIDE: 'Video Guía',
};

export function ComponentViewer({
  component,
  variant = 'card',
  className = '',
}: ComponentViewerProps) {
  const [expanded, setExpanded] = useState(true);

  const icon = COMPONENT_ICONS[component.type] || <BookOpen className="h-4 w-4" />;
  const label = COMPONENT_LABELS[component.type] || component.type;
  const content = renderComponentContent(component);

  if (variant === 'embedded') {
    return <div className={className}>{content}</div>;
  }

  return (
    <div className={`border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden ${className}`}>
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        title={label}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-shrink-0 text-gray-500 dark:text-gray-400">{icon}</div>
          <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{label}</span>
        </div>
        <div className="flex-shrink-0 ml-2">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          )}
        </div>
      </button>

      {expanded && <div className="p-4 bg-white dark:bg-[#1E2329]">{content}</div>}
    </div>
  );
}

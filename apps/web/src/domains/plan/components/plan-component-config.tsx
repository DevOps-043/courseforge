import {
  BrainCircuit,
  Book,
  FileText,
  LayoutList,
  MessageSquare,
  Play,
  Video as VideoIcon,
} from "lucide-react";

export const DEFAULT_PROMPT_PREVIEW = `Genera un plan instruccional detallado para cada lección del temario proporcionado.
Para cada lección, debes estructurar el contenido en 4 componentes obligatorios:
1. DIALOGUE: Guion conversacional o explicativo.
2. READING: Material de lectura complementario.
3. QUIZ: Pregunta de evaluación.
4. VIDEO: Sugerencia visual o script.
...`;

export const getComponentBadge = (type: string) => {
  const normalizedType = type.toUpperCase();

  if (normalizedType.includes("DIALOG")) {
    return {
      color: "text-blue-400 bg-blue-400/10 border-blue-400/20",
      icon: <MessageSquare size={12} />,
      label: "Diálogo",
    };
  }

  if (normalizedType.includes("READ")) {
    return {
      color: "text-green-400 bg-green-400/10 border-green-400/20",
      icon: <Book size={12} />,
      label: "Lectura",
    };
  }

  if (normalizedType === "VIDEO_DEMO" || normalizedType === "VIDEO_GUIDE") {
    return {
      color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
      icon: <VideoIcon size={12} />,
      label: "Video Demo",
    };
  }

  if (normalizedType.includes("VIDEO")) {
    return {
      color: "text-purple-400 bg-purple-400/10 border-purple-400/20",
      icon: <VideoIcon size={12} />,
      label: "Video Teórico",
    };
  }

  if (normalizedType.includes("QUIZ")) {
    return {
      color: "text-orange-400 bg-orange-400/10 border-orange-400/20",
      icon: <BrainCircuit size={12} />,
      label: "Quiz",
    };
  }

  if (normalizedType.includes("EXER")) {
    return {
      color: "text-pink-400 bg-pink-400/10 border-pink-400/20",
      icon: <LayoutList size={12} />,
      label: "Ejercicio",
    };
  }

  if (normalizedType.includes("DEMO_GUIDE")) {
    return {
      color: "text-teal-400 bg-teal-400/10 border-teal-400/20",
      icon: <Play size={12} />,
      label: "Demo Interactiva",
    };
  }

  return {
    color: "text-gray-400 bg-gray-400/10 border-gray-400/20",
    icon: <FileText size={12} />,
    label: type,
  };
};

export const COMPONENT_TYPES = [
  { value: "DIALOGUE", label: "Diálogo" },
  { value: "READING", label: "Lectura" },
  { value: "VIDEO_THEORY", label: "Video Teórico" },
  { value: "VIDEO_DEMO", label: "Video Demo" },
  { value: "QUIZ", label: "Quiz" },
  { value: "EXERCISE", label: "Ejercicio" },
  { value: "DEMO_GUIDE", label: "Guía Interactiva" },
];

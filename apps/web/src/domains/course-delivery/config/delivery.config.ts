export const DELIVERY_LIMITS = {
  sessions: 24,
  lessons: 300,
  sessionMinutes: 480,
  text: 8000,
  requestBytes: 2 * 1024 * 1024,
  workspaceBytes: 8 * 1024 * 1024,
  generationTimeoutMs: 90_000,
  generationOutputTokens: 16_000,
  pollIntervalMs: 3000,
  snapshotTimeoutMs: 15_000,
  runBudgetMs: 9 * 60_000,
} as const;

export const DELIVERY_CAPABILITIES = {
  AGENDA: { setting: "SYNCHRONOUS_AGENDA", parent: "SYLLABUS", prompt: "SYNCHRONOUS_AGENDA" },
  PLAN: { setting: "SYNCHRONOUS_PLAN", parent: "INSTRUCTIONAL_PLAN", prompt: "SYNCHRONOUS_PLAN" },
  MATERIALS: { setting: "SYNCHRONOUS_MATERIALS", parent: "MATERIALS", prompt: "SYNCHRONOUS_MATERIALS" },
} as const;

export const DELIVERY_PROMPTS = {
  SYNCHRONOUS_AGENDA: "Distribuye el syllabus aprobado en sesiones según cantidad y duración solicitadas. Conserva todos los objetivos y referencias de lección. Una sesión por módulo es solo la propuesta inicial. Identifica el alcance parcial o repaso deliberado. Propón título, objetivos y evidencia principal por sesión. No desarrolles materiales todavía.",
  SYNCHRONOUS_PLAN: "Diseña la conducción de esta sesión: bloques con propósito, tiempos, explicación del facilitador, actividad del participante, recursos necesarios y criterios de revisión. Incluye apertura, transiciones y cierre dentro de la duración disponible. En híbrido relaciona las lecciones Nexus y su uso antes/después: complementario prioriza aplicación; versión de clase cubre los objetivos esenciales. No inventes fuentes ni contenido curricular.",
  SYNCHRONOUS_MATERIALS: "Desarrolla contenido fundamentado para esta sesión desde su plan y fuentes aprobadas: conceptos, ejemplo desarrollado, confusiones frecuentes, actividades con consigna, respuesta razonada y criterios, notas breves y preparación del facilitador. Preparación: qué comprender, qué explicar, qué conducir, dónde profundizar y cómo ampliar. Cita solo IDs de fuentes suministradas. Conserva IDs de actividades y correspondencia entre consigna y respuesta. La presentación, guía y cuaderno derivarán de este mismo contenido.",
} as const;

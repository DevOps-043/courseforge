// GO-ESP-04: Tipos para Curaduria de Fuentes (Paso 4 / Fase 2)

// Estados del Paso 4
export type Esp04StepState =
  | 'PHASE2_DRAFT'
  | 'PHASE2_GENERATING'
  | 'PHASE2_GENERATED'
  | 'PHASE2_VALIDATING_URLS'  // Nuevo: validando URLs
  | 'PHASE2_HITL_REVIEW'
  | 'PHASE2_READY_FOR_QA'
  | 'PHASE2_APPROVED'
  | 'PHASE2_CORRECTABLE'
  | 'PHASE2_BLOCKED'

// Estado de validacion de URL
export type UrlStatus =
  | 'PENDING'        // Aun no verificada
  | 'OK'             // 2xx o 3xx con redirect final OK
  | 'MANUAL'         // Fuente agregada manualmente (siempre valida)
  | 'NOT_FOUND'      // 404/410
  | 'DNS_FAIL'       // DNS NXDOMAIN
  | 'TIMEOUT'        // Timeout
  | 'FORBIDDEN'      // 403
  | 'AUTH_REQUIRED'  // 401
  | 'INVALID_URL'    // URL malformada
  | 'INVALID_URL_TRUNCATED' // URL truncada con "..."
  | 'SSL_ERROR'      // Error de certificado
  | 'CONNECTION_ERROR' // Error de conexion
  | 'SERVER_ERROR'   // 5xx

// Motivos automaticos de NO_APTA basados en URL status
export type AutoNoAptaReason =
  | 'HTTP_400'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_410'
  | 'HTTP_500'
  | 'HTTP_503'
  | 'TIMEOUT'
  | 'FETCH_FAILED'
  | 'DNS_FAIL'
  | 'SSL_ERROR'
  | 'CONNECTION_ERROR'
  | 'URL_TRUNCATED'
  | 'URL_INVALID'

// Mapeo de UrlStatus a AutoNoAptaReason
export const URL_STATUS_TO_REASON: Record<string, AutoNoAptaReason | null> = {
  'PENDING': null,
  'OK': null,
  'NOT_FOUND': 'HTTP_404',
  'DNS_FAIL': 'DNS_FAIL',
  'TIMEOUT': 'TIMEOUT',
  'FORBIDDEN': 'HTTP_403',
  'AUTH_REQUIRED': 'HTTP_403',
  'INVALID_URL': 'URL_INVALID',
  'INVALID_URL_TRUNCATED': 'URL_TRUNCATED',
  'SSL_ERROR': 'SSL_ERROR',
  'CONNECTION_ERROR': 'CONNECTION_ERROR',
  'SERVER_ERROR': 'HTTP_500'
}

// Resultado de validacion de URL
export interface UrlValidationResult {
  url_status: UrlStatus
  http_status_code?: number
  last_checked_at: string
  failure_reason?: string
  final_url?: string  // URL final tras redirects
}

// Fila de la tabla de fuentes
export interface CurationRow {
  id: string
  lesson_id: string
  lesson_title: string
  component: string
  is_critical: boolean
  source_ref: string           // URL o titulo
  source_title?: string
  source_rationale?: string    // Justificacion de la IA
  // Validacion de URL
  url_status: UrlStatus
  http_status_code?: number
  last_checked_at?: string
  failure_reason?: string
  // Evaluacion HITL
  apta: boolean | null         // null = pendiente evaluacion
  motivo_no_apta?: string
  cobertura_completa: boolean | null
  notes?: string
  // Auto-evaluacion por URL status
  auto_evaluated?: boolean     // true si fue evaluado automaticamente por URL fallida
  auto_reason?: AutoNoAptaReason // Razon automatica del rechazo
  // Override para 403/paywall
  forbidden_override?: boolean // true si el usuario confirma acceso en su entorno
}

// Entrada de bitacora
export interface BitacoraEntry {
  id: string
  entry_type: 'DECISION' | 'DISCARD' | 'GAP' | 'NEXT_STEP' | 'NOTE'
  lesson_id?: string
  component?: string
  message: string
  created_at: string
  created_by?: string
}

// Bloqueador de curaduria
export interface CurationBlocker {
  id: string
  lesson_id: string
  lesson_title: string
  component: string
  impact: string
  owner: string
  status: 'OPEN' | 'MITIGATING' | 'ACCEPTED'
  created_at: string
}

// Check DoD
export interface CurationDodCheck {
  code: 'DOD_COVERAGE' | 'DOD_CRITICAL' | 'DOD_OPERABILITY' | 'DOD_TRACEABILITY'
  label: string
  pass: boolean
  evidence?: string
  notes?: string
}

// Resultado de validacion
export interface CurationValidationCheck {
  code: string
  pass: boolean
  message: string
  severity: 'error' | 'warning'
  lesson_id?: string
  component?: string
}

// Payload completo de curaduria
export interface CurationPayload {
  artifact_id: string
  attempt_number: 1 | 2
  rows: CurationRow[]
  bitacora: BitacoraEntry[]
  blockers: CurationBlocker[]
  dod: {
    checklist: CurationDodCheck[]
    automatic_checks: CurationValidationCheck[]
  }
  state: Esp04StepState
  qa_decision?: {
    decision: 'APPROVED' | 'CORRECTABLE' | 'BLOCKED'
    reviewed_by?: string
    reviewed_at?: string
    notes?: string
  }
}

// Resultado de operacion
export interface CurationResult {
  success: boolean
  state: Esp04StepState
  error?: string
}

// Input para la API: componente requerido por leccion
export interface RequiredComponent {
  lesson_id: string
  lesson_title: string
  component: string
  is_critical: boolean
}

// Output de la API: fuente candidata
export interface CandidateSource {
  title: string
  url: string
  rationale: string
  // Campos de validación de URL (agregados después de validar)
  url_status?: UrlStatus
  http_status_code?: number
  failure_reason?: string
  last_checked_at?: string
}

// Output de la API por componente
export interface ComponentSources {
  component_name: string
  is_critical: boolean
  candidate_sources: CandidateSource[]
}

// Output de la API por leccion
export interface LessonSources {
  lesson_id: string
  lesson_title: string
  components: ComponentSources[]
}

// Output completo de la API
export interface CurationApiOutput {
  sources_by_lesson: LessonSources[]
  url_validation_summary?: {
    total: number
    ok: number
    failed: number
    pending: number
  }
}

// Gap detectado para Intento 2
export type GapReason = 'URL_FAIL' | 'AUTH_REQUIRED' | 'NO_COVERAGE' | 'NO_SOURCES' | 'ALL_NO_APTA'

export interface DetectedGap {
  lesson_id: string
  lesson_title: string
  component: string
  is_critical: boolean
  reason: GapReason
  details?: string  // Ej: "3 fuentes con url_status=NOT_FOUND"
}

// Versiones del prompt de curacion para A/B testing
export type CurationPromptVersion = 'default' | 'strict_edu' | 'creative_search'

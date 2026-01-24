// Contexto de Base de Datos para Lia
// Proporciona información sobre artefactos, cursos y usuario actual

import { SupabaseClient } from '@supabase/supabase-js';

export interface LiaDBContext {
  user: {
    id: string;
    email: string;
    name?: string;
  } | null;
  artifacts: {
    id: string;
    course_id: string;
    title: string;
    state: string;
    created_at: string;
    has_syllabus: boolean;
    has_plan: boolean;
  }[];
  stats: {
    total_artifacts: number;
    generating: number;
    approved: number;
    pending_review: number;
  };
}

// Estados de artefactos para referencia
const ARTIFACT_STATES = {
  GENERATING: 'En generación',
  PENDING_REVIEW: 'Pendiente de revisión',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  ERROR: 'Error'
};

export async function getLiaDBContext(supabase: SupabaseClient): Promise<LiaDBContext> {
  // 1. Get current user
  const { data: { user } } = await supabase.auth.getUser();

  let userContext = null;
  if (user) {
    // Get profile info
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, email')
      .eq('id', user.id)
      .single();

    userContext = {
      id: user.id,
      email: user.email || '',
      name: profile?.username || user.email?.split('@')[0] || 'Usuario'
    };
  }

  // 2. Get recent artifacts (last 20)
  const { data: artifacts } = await supabase
    .from('artifacts')
    .select(`
      id,
      course_id,
      idea_central,
      state,
      created_at,
      syllabus(id),
      instructional_plans(id)
    `)
    .order('created_at', { ascending: false })
    .limit(20);

  const artifactsList = (artifacts || []).map((art: any) => ({
    id: art.id,
    course_id: art.course_id || '',
    title: art.idea_central || 'Sin título',
    state: art.state || 'UNKNOWN',
    created_at: art.created_at,
    has_syllabus: Array.isArray(art.syllabus) ? art.syllabus.length > 0 : !!art.syllabus,
    has_plan: Array.isArray(art.instructional_plans) ? art.instructional_plans.length > 0 : !!art.instructional_plans
  }));

  // 3. Calculate stats
  const stats = {
    total_artifacts: artifactsList.length,
    generating: artifactsList.filter(a => a.state === 'GENERATING').length,
    approved: artifactsList.filter(a => a.state === 'APPROVED' || a.state === 'STEP_APPROVED').length,
    pending_review: artifactsList.filter(a => a.state === 'PENDING_REVIEW' || a.state === 'GENERATED').length
  };

  return {
    user: userContext,
    artifacts: artifactsList,
    stats
  };
}

// Genera un resumen en texto del contexto para el prompt
export function generateDBContextSummary(context: LiaDBContext): string {
  let summary = `## CONTEXTO DE LA BASE DE DATOS\n\n`;

  // Usuario
  if (context.user) {
    summary += `### Usuario Actual\n`;
    summary += `- Nombre: ${context.user.name}\n`;
    summary += `- Email: ${context.user.email}\n\n`;
  }

  // Estadísticas
  summary += `### Estadísticas de Artefactos\n`;
  summary += `- Total: ${context.stats.total_artifacts}\n`;
  summary += `- En generación: ${context.stats.generating}\n`;
  summary += `- Aprobados: ${context.stats.approved}\n`;
  summary += `- Pendientes de revisión: ${context.stats.pending_review}\n\n`;

  // Lista de artefactos recientes
  if (context.artifacts.length > 0) {
    summary += `### Artefactos Recientes (últimos ${context.artifacts.length})\n`;
    summary += `| ID | Título | Estado | Fecha |\n`;
    summary += `|-----|--------|--------|-------|\n`;

    context.artifacts.slice(0, 10).forEach(art => {
      const date = new Date(art.created_at).toLocaleDateString('es-ES');
      const stateLabel = ARTIFACT_STATES[art.state as keyof typeof ARTIFACT_STATES] || art.state;
      const shortId = art.id.substring(0, 8);
      const shortTitle = art.title.length > 30 ? art.title.substring(0, 30) + '...' : art.title;
      summary += `| ${shortId} | ${shortTitle} | ${stateLabel} | ${date} |\n`;
    });
    summary += '\n';

    // Información útil para acciones
    summary += `### Información para Acciones\n`;
    summary += `- Para ver un artefacto: /admin/artifacts/[ID]\n`;
    summary += `- Para crear nuevo: /admin/artifacts/new\n`;
    summary += `- IDs completos de los últimos 5:\n`;
    context.artifacts.slice(0, 5).forEach(art => {
      summary += `  • "${art.title}": ${art.id}\n`;
    });
  } else {
    summary += `### Artefactos\nNo hay artefactos creados aún.\n`;
  }

  return summary;
}

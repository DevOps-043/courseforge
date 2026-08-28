import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { PRODUCTION_JOB_TYPES } from "@/domains/production/types/production.types";
import { createClient } from "@/utils/supabase/server";

const querySchema = z.object({
  componentId: z.string().uuid(),
  createdAfter: z.string().datetime().optional(),
  jobId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  const parsed = querySchema.safeParse({
    componentId: new URL(request.url).searchParams.get("componentId"),
    createdAfter: new URL(request.url).searchParams.get("createdAfter") || undefined,
    jobId: new URL(request.url).searchParams.get("jobId") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
  }

  const supabase = await createClient();
  if (!(await getAuthenticatedUser(supabase))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const authorized = await getAuthorizedMaterialComponentAdmin(parsed.data.componentId);
  if (!authorized) {
    return NextResponse.json({ error: "Componente no encontrado." }, { status: 404 });
  }

  let query = authorized.admin
    .from("production_jobs")
    .select("id, status, provider_error, created_at, updated_at")
    .eq("material_component_id", parsed.data.componentId)
    .eq("job_type", PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION)
    .order("created_at", { ascending: false })
    .limit(1);
  if (parsed.data.jobId) {
    query = query.eq("id", parsed.data.jobId);
  } else if (parsed.data.createdAfter) {
    query = query.gte("created_at", parsed.data.createdAfter);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: component } = await authorized.admin
    .from("material_components")
    .select("assets")
    .eq("id", parsed.data.componentId)
    .single();

  return NextResponse.json({
    success: true,
    data: {
      assets: component?.assets || {},
      job: data || null,
      status: data?.status || "QUEUED",
    },
  });
}

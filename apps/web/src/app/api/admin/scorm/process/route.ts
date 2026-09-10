import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { dispatchBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  classifyScormImportStatus,
  SCORM_IMPORT_STATUS,
  SCORM_PROCESSING_STEP,
  scormProcessRequestSchema,
} from "@/domains/scorm/scorm-job-contracts";

const SCORM_STATUS_SELECT = "id, artifact_id, status, processing_step, organization_id";

async function authorizeScormAdmin() {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return { authorized: false as const, status: 401 as const };

  const tenant = await resolveActiveTenantContext();
  if (!tenant || !await canReviewContent(authenticatedUser.userId, tenant)) {
    return { authorized: false as const, status: 403 as const };
  }
  return { authorized: true as const, tenant };
}

function statusResponse(importRecord: {
  artifact_id?: string | null;
  id: string;
  processing_step?: string | null;
  status?: string | null;
}) {
  const kind = classifyScormImportStatus(importRecord.status);
  return {
    artifactId: importRecord.artifact_id || null,
    importId: importRecord.id,
    kind,
    processingStep: importRecord.processing_step || null,
    status: importRecord.status || "UNKNOWN",
    success: kind === "completed",
  };
}

export async function GET(req: NextRequest) {
  const authorized = await authorizeScormAdmin();
  if (!authorized.authorized) {
    return NextResponse.json(
      { error: authorized.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: authorized.status },
    );
  }

  const parsed = scormProcessRequestSchema.safeParse({
    importId: req.nextUrl.searchParams.get("importId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Import ID inválido." }, { status: 400 });
  }

  const admin = getServiceRoleClient();
  const { data: importRecord, error } = await admin
    .from("scorm_imports")
    .select(SCORM_STATUS_SELECT)
    .eq("id", parsed.data.importId)
    .eq("organization_id", authorized.tenant.organizationId)
    .maybeSingle();

  if (error) {
    console.error("[SCORM/status] Lookup failed", { importId: parsed.data.importId, error: error.message });
    return NextResponse.json({ error: "No se pudo consultar la importación." }, { status: 500 });
  }
  if (!importRecord) {
    return NextResponse.json({ error: "Importación no encontrada." }, { status: 404 });
  }
  return NextResponse.json(statusResponse(importRecord));
}

export async function POST(req: NextRequest) {
  const authorized = await authorizeScormAdmin();
  if (!authorized.authorized) {
    return NextResponse.json(
      { error: authorized.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: authorized.status },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const parsed = scormProcessRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Import ID inválido." }, { status: 400 });
  }

  const { importId } = parsed.data;
  const organizationId = authorized.tenant.organizationId;
  const admin = getServiceRoleClient();
  const { data: current, error: lookupError } = await admin
    .from("scorm_imports")
    .select(SCORM_STATUS_SELECT)
    .eq("id", importId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (lookupError) {
    console.error("[SCORM/process] Lookup failed", { importId, error: lookupError.message });
    return NextResponse.json({ error: "No se pudo iniciar la importación." }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: "Importación no encontrada." }, { status: 404 });

  const currentKind = classifyScormImportStatus(current.status);
  if (currentKind === "completed") return NextResponse.json(statusResponse(current));
  if (currentKind === "active") {
    return NextResponse.json(statusResponse(current), { status: 202 });
  }
  if (currentKind === "failed") {
    return NextResponse.json(
      { error: "La importación falló y requiere revisión antes de reintentarse." },
      { status: 409 },
    );
  }
  if (currentKind !== "ready") {
    return NextResponse.json(
      { error: "El paquete SCORM todavía no está listo para transformarse." },
      { status: 409 },
    );
  }

  const { data: queued, error: queueError } = await admin
    .from("scorm_imports")
    .update({
      error_message: null,
      processing_step: SCORM_PROCESSING_STEP.queued,
      status: SCORM_IMPORT_STATUS.transforming,
    })
    .eq("id", importId)
    .eq("organization_id", organizationId)
    .eq("status", current.status)
    .select(SCORM_STATUS_SELECT)
    .maybeSingle();

  if (queueError) {
    console.error("[SCORM/process] Reservation failed", { importId, error: queueError.message });
    return NextResponse.json({ error: "No se pudo reservar la importación." }, { status: 500 });
  }
  if (!queued) {
    return NextResponse.json({ importId, status: SCORM_IMPORT_STATUS.transforming, kind: "active" }, { status: 202 });
  }

  try {
    await dispatchBackgroundFunctionJson(
      "scorm-transformation-background",
      {
        importId,
        organizationId,
      },
      {
        fallbackError: "No se pudo despachar la transformación SCORM.",
        localHandlerLoader: () => import("../../../../../../netlify/functions/scorm-transformation-background"),
      },
    );
  } catch (dispatchError) {
    console.error("[SCORM/process] Dispatch failed", { importId, dispatchError });
    await admin
      .from("scorm_imports")
      .update({ processing_step: null, status: current.status })
      .eq("id", importId)
      .eq("organization_id", organizationId)
      .eq("processing_step", SCORM_PROCESSING_STEP.queued);
    return NextResponse.json({ error: "No se pudo despachar la transformación SCORM." }, { status: 503 });
  }

  return NextResponse.json(statusResponse(queued), { status: 202 });
}

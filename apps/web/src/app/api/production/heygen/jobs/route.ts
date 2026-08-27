import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import { createClient } from "@/utils/supabase/server";

const latestJobQuerySchema = z.object({
  componentId: z.string().uuid(),
});

export async function GET(request: Request) {
  try {
    const query = latestJobQuerySchema.parse({
      componentId: new URL(request.url).searchParams.get("componentId"),
    });
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para consultar jobs de HeyGen." },
        { status: 403 },
      );
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json(
        { error: "Empresa no valida o no autorizada." },
        { status: 403 },
      );
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(
      query.componentId,
    );
    if (!authorizedComponent) {
      return NextResponse.json(
        { error: "Componente no encontrado para esta empresa." },
        { status: 404 },
      );
    }

    const repository = new HeygenRepository(authorizedComponent.admin);
    const latestJob = await repository.getLatestAvatarVideoJobForComponent({
      componentId: query.componentId,
      organizationId: tenant.organizationId,
    });

    if (!latestJob) {
      return NextResponse.json({
        success: true,
        data: { asset: null, latestJob: null },
      });
    }

    const [asset, voiceAsset] = await Promise.all([
      repository.findAvatarVideoAssetByJob(latestJob.id),
      repository.findVoiceAudioAssetByJob(latestJob.id),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        asset: asset
          ? {
              id: asset.id,
              publicUrl: asset.public_url || null,
              storagePath: asset.storage_path || null,
            }
          : null,
        voiceAsset: voiceAsset?.public_url && voiceAsset.storage_path
          ? {
              durationSeconds:
                voiceAsset.duration_seconds ||
                (voiceAsset.duration_milliseconds
                  ? voiceAsset.duration_milliseconds / 1_000
                  : null),
              id: voiceAsset.id,
              metadata: voiceAsset.metadata || {},
              publicUrl: voiceAsset.public_url,
              storagePath: voiceAsset.storage_path,
            }
          : null,
        latestJob: {
          createdAt: latestJob.created_at || null,
          jobId: latestJob.id,
          outputSnapshot: latestJob.output_snapshot || {},
          providerJobId: latestJob.provider_job_id || null,
          providerError: latestJob.provider_error || null,
          providerModel: latestJob.provider_model || null,
          status: latestJob.status,
          updatedAt: latestJob.updated_at || null,
        },
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Parametros invalidos para consultar jobs de HeyGen." },
        { status: 400 },
      );
    }

    console.error("[API /production/heygen/jobs] Unexpected error:", {
      message: getErrorMessage(error),
    });

    return NextResponse.json(
      { error: "Error interno del servidor al consultar jobs de HeyGen." },
      { status: 500 },
    );
  }
}

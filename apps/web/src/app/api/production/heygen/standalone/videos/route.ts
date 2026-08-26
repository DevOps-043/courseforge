import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HeygenApiError,
} from "@/domains/production/providers/heygen/heygen.client";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import {
  assertHeygenTextInputWithinLimits,
  buildResolutionRejectionHint,
  HEYGEN_MAX_TEXT_INPUT_CHARACTERS,
  HeygenRequestValidationError,
} from "@/domains/production/providers/heygen/heygen-request-constraints";
import { createClient } from "@/utils/supabase/server";

const standaloneVideoRequestSchema = z
  .object({
    aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
    avatarPresetId: z.string().uuid().optional(),
    caption: z.boolean().default(false),
    engine: z.enum(["avatar_iv", "avatar_v"]).default("avatar_iv"),
    outputFormat: z.enum(["mp4", "webm"]).default("mp4"),
    resolution: z.enum(["720p", "1080p", "4k"]).default("1080p"),
    script: z.string().trim().min(20).max(HEYGEN_MAX_TEXT_INPUT_CHARACTERS),
    title: z.string().trim().min(3).max(120),
    voicePresetId: z.string().uuid().optional(),
  })
  .strict();

export async function POST(request: Request) {
  let requestedResolution: "720p" | "1080p" | "4k" = "1080p";
  try {
    const payload = standaloneVideoRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    requestedResolution = payload.resolution;
    assertHeygenTextInputWithinLimits({
      label: "El guion standalone",
      text: payload.script,
    });
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para generar videos con HeyGen." },
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

    const repository = new HeygenRepository(getServiceRoleClient());
    const avatar = await repository.getAvatarPresetForGeneration({
      organizationId: tenant.organizationId,
      presetId: payload.avatarPresetId,
    });
    if (!avatar) {
      return NextResponse.json(
        { error: "No hay avatar HeyGen disponible para esta empresa." },
        { status: 400 },
      );
    }

    const voice = payload.voicePresetId
      ? await repository.getVoicePresetForGeneration({
          organizationId: tenant.organizationId,
          presetId: payload.voicePresetId,
        })
      : null;
    const providerVoiceId = voice?.heygen_voice_id || avatar.default_voice_id;
    if (!providerVoiceId) {
      return NextResponse.json(
        {
          error:
            "Selecciona una voz o marca una voz default para el avatar HeyGen.",
        },
        { status: 400 },
      );
    }

    const admin = getServiceRoleClient();
    const heygenAuth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const createdVideo = await heygenAuth.client.createAvatarVideo(
      {
        aspect_ratio: payload.aspectRatio,
        avatar_id: avatar.heygen_avatar_look_id,
        callback_id: `standalone-${tenant.organizationId}`,
        caption: payload.caption
          ? { file_format: "srt", style: "default" }
          : undefined,
        engine: { type: payload.engine },
        output_format: payload.outputFormat,
        resolution: payload.resolution,
        script: payload.script,
        title: payload.title,
        type: "avatar",
        voice_id: providerVoiceId,
      },
      `heygen-standalone-${tenant.organizationId}-${crypto.randomUUID()}`,
    );

    return NextResponse.json({
      success: true,
      data: {
        jobId: createdVideo.videoId,
        providerJobId: createdVideo.videoId,
        providerStatus: createdVideo.providerStatus || null,
        standalone: true,
        status: "WAITING_PROVIDER",
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Payload invalido para generar video HeyGen standalone." },
        { status: 400 },
      );
    }

    if (error instanceof HeygenRequestValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof HeygenApiError) {
      return NextResponse.json(
        {
          error: error.message,
          hint: buildResolutionRejectionHint(requestedResolution, error),
          providerCode: error.providerCode || null,
          retryAfterSeconds: error.retryAfterSeconds || null,
        },
        {
          headers: buildRetryAfterHeaders(error.retryAfterSeconds),
          status: error.status === 429 ? 429 : 502,
        },
      );
    }

    if (error instanceof HeygenCredentialResolverError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("[API /production/heygen/standalone/videos] Unexpected error:", {
      message: getErrorMessage(error),
    });

    return NextResponse.json(
      { error: "Error interno del servidor al generar video HeyGen standalone." },
      { status: 500 },
    );
  }
}

function buildRetryAfterHeaders(retryAfterSeconds?: number) {
  return retryAfterSeconds
    ? { "Retry-After": String(retryAfterSeconds) }
    : undefined;
}

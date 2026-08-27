import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import {
  assertSafeHeygenAudioUrl,
  downloadHeygenAudioWithLimits,
} from "@/domains/production/providers/heygen/heygen-audio-import.service";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import {
  assertHeygenTextInputWithinLimits,
  HeygenRequestValidationError,
} from "@/domains/production/providers/heygen/heygen-request-constraints";
import {
  HeygenVideoService,
  HeygenVideoServiceError,
} from "@/domains/production/providers/heygen/heygen-video.service";
import { heygenGenerateVoiceoverRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";

/** Generates TTS with HeyGen's audio-only endpoint. No avatar video is submitted. */
export async function POST(request: Request) {
  try {
    const payload = heygenGenerateVoiceoverRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return NextResponse.json({ error: "No tienes permisos para generar voz en off." }, { status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });

    if (payload.componentId) {
      const authorized = await getAuthorizedMaterialComponentAdmin(payload.componentId);
      if (!authorized) {
        return NextResponse.json({ error: "Componente no encontrado para esta empresa." }, { status: 404 });
      }
      const auth = await getHeygenClientForOrganization({
        allowGlobalFallback: false,
        organizationId: tenant.organizationId,
        supabase: authorized.admin,
      });
      const service = new HeygenVideoService(authorized.admin, auth.client);
      const data = await service.createVoiceoverForComponent({
        componentContent: authorized.component.content,
        componentType: authorized.component.type || "VIDEO_THEORETICAL",
        createdBy: user.userId,
        fallbackTitle: null,
        options: {
          componentId: payload.componentId,
          inputType: payload.inputType,
          language: payload.language,
          locale: payload.locale,
          speed: payload.speed,
          voicePresetId: payload.voicePresetId,
        },
        organizationId: tenant.organizationId,
      });
      return NextResponse.json({
        success: true,
        data: {
          ...data,
          providerJobId: data.voiceAsset.providerRequestId,
          standalone: false,
        },
      });
    }

    const script = payload.script!;
    assertHeygenTextInputWithinLimits({ label: "El texto de voz en off", text: script });
    const admin = getServiceRoleClient();
    const repository = new HeygenRepository(admin);
    const voice = await repository.getVoicePresetForGeneration({
      organizationId: tenant.organizationId,
      presetId: payload.voicePresetId,
    });
    if (!voice?.heygen_voice_id) {
      return NextResponse.json({ error: "Selecciona una voz HeyGen válida." }, { status: 400 });
    }
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const speech = await auth.client.generateSpeech({
      input_type: payload.inputType,
      language: payload.language,
      locale: payload.locale,
      speed: payload.speed,
      text: script,
      voice_id: voice.heygen_voice_id,
    });
    assertSafeHeygenAudioUrl(speech.audioUrl);
    const downloaded = await downloadHeygenAudioWithLimits({ url: speech.audioUrl });
    const requestId = speech.requestId || crypto.randomUUID();
    const safeRequestId = requestId.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 120) || crypto.randomUUID();
    const objectPath = `heygen/standalone/${tenant.organizationId}/${safeRequestId}.${downloaded.extension}`;
    const { error: uploadError } = await admin.storage
      .from("production-assets")
      .upload(objectPath, downloaded.buffer, {
        cacheControl: "31536000",
        contentType: downloaded.contentType,
        upsert: true,
      });
    if (uploadError) throw uploadError;
    const publicUrl = admin.storage.from("production-assets").getPublicUrl(objectPath).data.publicUrl;
    const { data: standaloneAsset, error: assetError } = await admin
      .from("heygen_standalone_assets")
      .upsert({
        asset_type: "VOICE_AUDIO",
        created_by: user.userId,
        duration_seconds: speech.durationSeconds,
        metadata: {
          input_type: payload.inputType || "text",
          language: payload.language || null,
          locale: payload.locale || null,
          script,
          voice_preset_id: payload.voicePresetId,
          word_timestamps: speech.wordTimestamps,
        },
        mime_type: downloaded.contentType,
        organization_id: tenant.organizationId,
        provider_request_id: speech.requestId || null,
        public_url: publicUrl,
        storage_bucket: "production-assets",
        storage_path: objectPath,
        title: payload.title || "Voz en off",
      }, { onConflict: "organization_id,storage_bucket,storage_path" })
      .select("id")
      .single();
    if (assetError) throw assetError;
    return NextResponse.json({
      success: true,
      data: {
        jobId: requestId,
        providerJobId: speech.requestId || null,
        standalone: true,
        status: "SUCCEEDED",
        title: payload.title || "Voz en off",
        voiceAsset: {
          durationSeconds: speech.durationSeconds,
          id: standaloneAsset.id,
          providerRequestId: speech.requestId || null,
          publicUrl,
          storagePath: `production-assets/${objectPath}`,
          wordTimestamps: speech.wordTimestamps,
        },
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Payload inválido para voz en off." }, { status: 400 });
    }
    if (error instanceof HeygenVideoServiceError || error instanceof HeygenRequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof HeygenCredentialResolverError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof HeygenApiError) {
      return NextResponse.json(
        { error: error.message, providerCode: error.providerCode || null },
        { status: error.status === 429 ? 429 : 502 },
      );
    }
    console.error("[API /production/heygen/speech] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "Error interno al generar la voz en off." }, { status: 500 });
  }
}

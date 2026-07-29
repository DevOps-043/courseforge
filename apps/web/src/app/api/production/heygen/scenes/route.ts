import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HeygenScenesService,
  HeygenScenesServiceError,
} from "@/domains/production/providers/heygen/heygen-scenes.service";
import { heygenScenesPatchRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";

const componentIdSchema = z.string().uuid();

export async function GET(request: Request) {
  try {
    const componentId = componentIdSchema.parse(
      new URL(request.url).searchParams.get("componentId"),
    );
    const auth = await authorizeComponent(componentId, "consultar escenas HeyGen");
    if (auth.response) return auth.response;

    const service = new HeygenScenesService(auth.authorizedComponent.admin);
    const existingClips = auth.authorizedComponent.component.assets?.avatar_clips || [];
    const clips = service.buildSceneClips({
      componentContent: auth.authorizedComponent.component.content,
      existingClips,
    });

    return NextResponse.json({
      success: true,
      data: {
        avatarGenerationMode:
          auth.authorizedComponent.component.assets?.avatar_generation_mode || "scene_clips",
        clips,
        componentId,
      },
    });
  } catch (error: unknown) {
    return handleScenesError(error, "consultar escenas HeyGen");
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = heygenScenesPatchRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    const auth = await authorizeComponent(payload.componentId, "guardar escenas HeyGen");
    if (auth.response) return auth.response;

    const service = new HeygenScenesService(auth.authorizedComponent.admin);
    const materialAssets = await service.saveSceneClips({
      avatarGenerationMode: payload.avatarGenerationMode,
      clips: payload.clips,
      componentId: payload.componentId,
    });

    return NextResponse.json({
      success: true,
      data: {
        avatarGenerationMode: materialAssets.avatar_generation_mode,
        clips: materialAssets.avatar_clips || [],
      },
    });
  } catch (error: unknown) {
    return handleScenesError(error, "guardar escenas HeyGen");
  }
}

async function authorizeComponent(componentId: string, action: string) {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return { response: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  const canReview = await canReviewContent(authenticatedUser.userId);
  if (!canReview) {
    return {
      response: NextResponse.json(
        { error: `No tienes permisos para ${action}.` },
        { status: 403 },
      ),
    };
  }

  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return {
      response: NextResponse.json(
        { error: "Empresa no valida o no autorizada." },
        { status: 403 },
      ),
    };
  }

  const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
  if (!authorizedComponent) {
    return {
      response: NextResponse.json(
        { error: "Componente no encontrado para esta empresa." },
        { status: 404 },
      ),
    };
  }

  return { authenticatedUser, authorizedComponent, tenant };
}

function handleScenesError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: `Payload invalido para ${action}.` },
      { status: 400 },
    );
  }

  if (error instanceof HeygenScenesServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[API /production/heygen/scenes] Unexpected error:", {
    message: getErrorMessage(error),
  });

  return NextResponse.json(
    { error: `Error interno del servidor al ${action}.` },
    { status: 500 },
  );
}

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { courseDeckSpecSchema } from "../specs/course-deck.schema";
import { buildCourseDeckEditableArtifact, COURSE_DECK_EDITORIAL_VERSION } from "../render/course-deck-editable-artifact.server";
import { resolveGeneratedCourseDeckImageAssets } from "./course-deck-editorial-preparation.server";
import { resolveGeneratedCourseDeckFonts } from "./course-deck-editorial-fonts.server";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import { prepareAnimatedDeckForRemotion } from "../../validation/animated-deck-preprocessor.service";
import { htmlEditingBindingSchema } from "../../composition-editor/html-editing/html-editing.contract";

export const GENERATED_DECK_READER_POLICY = Object.freeze({ maximumSpecBytes: 1024 * 1024, maximumArtifactBytes: 4 * 1024 * 1024 });
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const referenceSchema = z.object({ format: z.literal(COURSE_DECK_EDITORIAL_VERSION), storage_path: z.string(),
  sha256: hash, source_spec_sha256: hash, slide_count: z.number().int().min(1).max(24),
  field_count: z.number().int().positive(), activation: z.literal("REQUIRES_AUTHORIZED_DRAFT_REGISTRATION") }).strict();

export class GeneratedDeckReadError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INTEGRITY_MISMATCH" | "FONT_BINDING_REQUIRED") {
    super(`GENERATED_DECK_${code}`); this.name = "GeneratedDeckReadError";
  }
}

function relation(value: unknown): Record<string, unknown> | undefined {
  const candidate = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : undefined;
}

/** Reads saved material through its tenant relation, not request JSON. Storage
 * bytes are not catalog authority: independently reproduce the owned renderer's
 * output and compare its complete hash with the content-addressed reference.
 * No download or network font fallback is needed to establish provenance. */
export async function readGeneratedCourseDeckEditorial(input: {
  componentId: string; organizationId: string; supabase: SupabaseClient; signal?: AbortSignal;
}) {
  try {
    z.string().uuid().parse(input.componentId); z.string().uuid().parse(input.organizationId);
    input.signal?.throwIfAborted();
    let query = input.supabase.from("material_components")
      .select("id, assets, material_lessons!inner(materials!inner(artifacts!inner(organization_id)))")
      .eq("id", input.componentId)
      .eq("material_lessons.materials.artifacts.organization_id", input.organizationId);
    if (input.signal) query = query.abortSignal(input.signal);
    const { data, error } = await query.maybeSingle();
    input.signal?.throwIfAborted();
    if (error || !data || data.id !== input.componentId) throw new GeneratedDeckReadError("UNAVAILABLE");
    const artifactOwner = relation(relation(relation(data.material_lessons)?.materials)?.artifacts);
    if (artifactOwner?.organization_id !== input.organizationId) throw new GeneratedDeckReadError("UNAVAILABLE");
    const slides = relation(relation(data.assets)?.slides);
    if (slides?.editable_deck == null) return null;
    const reference = referenceSchema.parse(slides.editable_deck);
    if (reference.storage_path !== `production-assets/slides/${input.componentId}-soflia-engine-deck.editable-${reference.sha256}.json`
      || Buffer.byteLength(JSON.stringify(slides.prepared_spec) ?? "", "utf8") > GENERATED_DECK_READER_POLICY.maximumSpecBytes)
      throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
    const deck = courseDeckSpecSchema.parse(slides.prepared_spec);
    if (deck.materialComponentId !== input.componentId || sha256(JSON.stringify(deck)) !== reference.source_spec_sha256)
      throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
    const imageIds = await resolveGeneratedCourseDeckImageAssets({ ...input, deck });
    const artifact = buildCourseDeckEditableArtifact(deck, imageIds);
    input.signal?.throwIfAborted();
    const encoded = JSON.stringify(artifact);
    if (Buffer.byteLength(encoded, "utf8") > GENERATED_DECK_READER_POLICY.maximumArtifactBytes
      || sha256(encoded) !== reference.sha256 || reference.slide_count !== artifact.fragments.length
      || reference.field_count !== artifact.fragments.reduce((count, fragment) => count + fragment.template.elements.length, 0))
      throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
    // Host-owned closure; never serialize it or accept an instance template from
    // the browser. Cache once per clip within this request, not across revocation.
    const instances = new Map<string, typeof artifact.fragments[number]>();
    let fontBindings;
    try { fontBindings = await resolveGeneratedCourseDeckFonts({ ...input, requirements: artifact.fontRequirements }); }
    catch { throw new GeneratedDeckReadError("FONT_BINDING_REQUIRED"); }
    return { artifact, fontBindings, presentationSource: () => prepareAnimatedDeckForRemotion(renderCourseDeckHtml(deck)).deck,
      instance: (clipId: string, slideIndex: number) => {
      if (!htmlEditingBindingSchema.shape.clipId.safeParse(clipId).success) throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
      const key = `${clipId}:${slideIndex}`;
      let instance = instances.get(key);
      if (!instance) {
        instance = buildCourseDeckEditableArtifact(deck, imageIds, { clipId, slideIndex }).fragments.find(fragment => fragment.index === slideIndex);
        if (!instance) throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
        instances.set(key, instance);
      }
      return instance;
    } };
  } catch (error) {
    if (error instanceof GeneratedDeckReadError) throw error;
    throw new GeneratedDeckReadError("UNAVAILABLE");
  }
}

export type VerifiedGeneratedDeck = NonNullable<Awaited<ReturnType<typeof readGeneratedCourseDeckEditorial>>>;

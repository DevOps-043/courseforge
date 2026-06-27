import type { createClient } from "@/utils/supabase/server";
import type { ComponentType, MaterialAssets } from "@/domains/materials/types/materials.types";
import {
  libraryItemMatchesQuery,
  normalizeLibraryComponent,
  type LibraryComponentSource,
} from "./library-normalizer";
import type {
  LibraryAssetType,
  LibraryContentCategory,
  LibrarySearchFilters,
  LibrarySearchResponse,
} from "./types";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_ROWS = 1000;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface ArtifactRow {
  course_id?: string | null;
  id: string;
  idea_central?: string | null;
  organization_id?: string | null;
}

interface MaterialRow {
  artifact_id?: string | null;
  id: string;
}

interface MaterialLessonRow {
  id: string;
  lesson_id?: string | null;
  lesson_title?: string | null;
  materials_id?: string | null;
}

interface MaterialComponentRow {
  assets?: MaterialAssets | null;
  generated_at: string;
  id: string;
  material_lesson_id?: string | null;
  type: ComponentType;
}

export interface SearchLibraryParams {
  filters?: LibrarySearchFilters;
  organizationId: string;
  organizationName: string;
  query?: string;
  supabase: SupabaseServerClient;
}

function normalizePage(value: unknown) {
  return Math.max(Number(value) || DEFAULT_PAGE, DEFAULT_PAGE);
}

function normalizePageSize(value: unknown) {
  const requested = Number(value) || DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(requested, 1), MAX_PAGE_SIZE);
}

function normalizeCategory(value: LibraryContentCategory | undefined) {
  return value || "ALL";
}

function normalizeAssetType(value: LibraryAssetType | undefined) {
  return value || "ALL";
}

async function fetchOrganizationArtifacts(
  supabase: SupabaseServerClient,
  organizationId: string,
) {
  const { data, error } = await supabase
    .from("artifacts")
    .select("id, course_id, idea_central, organization_id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(MAX_QUERY_ROWS);

  if (error) {
    throw new Error(`No se pudieron leer talleres de la empresa: ${error.message}`);
  }

  return (data || []) as ArtifactRow[];
}

async function fetchMaterialsForArtifacts(
  supabase: SupabaseServerClient,
  artifactIds: string[],
) {
  if (artifactIds.length === 0) return [] as MaterialRow[];

  const { data, error } = await supabase
    .from("materials")
    .select("id, artifact_id")
    .in("artifact_id", artifactIds)
    .limit(MAX_QUERY_ROWS);

  if (error) {
    throw new Error(`No se pudieron leer paquetes de materiales: ${error.message}`);
  }

  return (data || []) as MaterialRow[];
}

async function fetchLessonsForMaterials(
  supabase: SupabaseServerClient,
  materialIds: string[],
) {
  if (materialIds.length === 0) return [] as MaterialLessonRow[];

  const { data, error } = await supabase
    .from("material_lessons")
    .select("id, materials_id, lesson_id, lesson_title")
    .in("materials_id", materialIds)
    .limit(MAX_QUERY_ROWS);

  if (error) {
    throw new Error(`No se pudieron leer lecciones de materiales: ${error.message}`);
  }

  return (data || []) as MaterialLessonRow[];
}

async function fetchComponentsForLessons(
  supabase: SupabaseServerClient,
  lessonIds: string[],
  filters: LibrarySearchFilters,
) {
  if (lessonIds.length === 0) return [] as MaterialComponentRow[];

  let query = supabase
    .from("material_components")
    .select("id, material_lesson_id, type, assets, generated_at")
    .in("material_lesson_id", lessonIds)
    .order("generated_at", { ascending: false })
    .limit(MAX_QUERY_ROWS);

  if (filters.componentType && filters.componentType !== "ALL") {
    query = query.eq("type", filters.componentType);
  }

  if (filters.status && filters.status !== "ALL" && filters.status !== "PENDING") {
    query = query.eq("assets->>production_status", filters.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`No se pudieron leer componentes de libreria: ${error.message}`);
  }

  return (data || []) as MaterialComponentRow[];
}

function mapComponentsToLibrarySources(params: {
  artifacts: ArtifactRow[];
  components: MaterialComponentRow[];
  lessons: MaterialLessonRow[];
  materials: MaterialRow[];
  organizationId: string;
  organizationName: string;
}) {
  const artifactsById = new Map(params.artifacts.map((artifact) => [artifact.id, artifact]));
  const materialsById = new Map(params.materials.map((material) => [material.id, material]));
  const lessonsById = new Map(params.lessons.map((lesson) => [lesson.id, lesson]));

  return params.components
    .map((component): LibraryComponentSource | null => {
      const lesson = component.material_lesson_id
        ? lessonsById.get(component.material_lesson_id)
        : null;
      const material = lesson?.materials_id ? materialsById.get(lesson.materials_id) : null;
      const artifact = material?.artifact_id ? artifactsById.get(material.artifact_id) : null;

      if (!lesson || !artifact) {
        return null;
      }

      return {
        assets: component.assets || null,
        componentId: component.id,
        componentType: component.type,
        courseCode: artifact.course_id,
        generatedAt: component.generated_at,
        lessonId: lesson.lesson_id,
        lessonTitle: lesson.lesson_title,
        organizationId: params.organizationId,
        organizationName: params.organizationName,
        workshopId: artifact.id,
        workshopName: artifact.idea_central,
      };
    })
    .filter((source): source is LibraryComponentSource => Boolean(source));
}

export async function searchLibrary(params: SearchLibraryParams): Promise<LibrarySearchResponse> {
  const filters = params.filters || {};
  const page = normalizePage(filters.page);
  const pageSize = normalizePageSize(filters.pageSize);
  const category = normalizeCategory(filters.category);
  const assetType = normalizeAssetType(filters.assetType);

  const artifacts = await fetchOrganizationArtifacts(params.supabase, params.organizationId);
  const artifactIds = artifacts.map((artifact) => artifact.id);
  const materials = await fetchMaterialsForArtifacts(params.supabase, artifactIds);
  const lessons = await fetchLessonsForMaterials(
    params.supabase,
    materials.map((material) => material.id),
  );
  const components = await fetchComponentsForLessons(
    params.supabase,
    lessons.map((lesson) => lesson.id),
    filters,
  );

  const sources = mapComponentsToLibrarySources({
    artifacts,
    components,
    lessons,
    materials,
    organizationId: params.organizationId,
    organizationName: params.organizationName,
  });

  const normalizedItems = sources.flatMap(normalizeLibraryComponent);
  const filteredItems = normalizedItems
    .filter((item) => {
      if (category === "MATERIALS" && item.kind !== "material") return false;
      if (category === "ASSETS" && item.kind !== "asset") return false;
      if (assetType !== "ALL" && item.assetType !== assetType) return false;
      if (filters.status && filters.status !== "ALL" && item.productionStatus !== filters.status) {
        return false;
      }
      return libraryItemMatchesQuery(item, params.query || "");
    })
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );

  const offset = (page - 1) * pageSize;

  return {
    items: filteredItems.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: filteredItems.length,
  };
}

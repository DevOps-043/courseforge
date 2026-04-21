const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../apps/web/.env.local") });

function printUsage() {
  console.log(`
Uso:
  node scripts/prune_material_component_history.js --artifact-id <uuid>
  node scripts/prune_material_component_history.js --slug <course-slug>
  node scripts/prune_material_component_history.js --artifact-id <uuid> --execute

Opciones:
  --artifact-id   Artifact ID de Courseforge
  --slug          Slug de publication_requests
  --execute       Aplica el borrado. Sin este flag solo hace dry-run
  --help          Muestra esta ayuda
`);
}

function parseArgs(argv) {
  const args = {
    artifactId: null,
    slug: null,
    execute: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--artifact-id") {
      args.artifactId = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (current === "--slug") {
      args.slug = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (current === "--execute") {
      args.execute = true;
      continue;
    }

    if (current === "--help" || current === "-h") {
      args.help = true;
    }
  }

  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function chunk(array, size) {
  const output = [];
  for (let index = 0; index < array.length; index += size) {
    output.push(array.slice(index, index + size));
  }
  return output;
}

function compareComponents(left, right) {
  const iterationDiff =
    (Number(right.iteration_number) || 0) - (Number(left.iteration_number) || 0);
  if (iterationDiff !== 0) {
    return iterationDiff;
  }

  const generatedAtLeft = new Date(left.generated_at || 0).getTime();
  const generatedAtRight = new Date(right.generated_at || 0).getTime();
  if (generatedAtRight !== generatedAtLeft) {
    return generatedAtRight - generatedAtLeft;
  }

  return String(right.id).localeCompare(String(left.id));
}

async function resolveArtifactId(supabase, args) {
  if (args.artifactId) {
    return args.artifactId;
  }

  if (!args.slug) {
    throw new Error("Debes indicar --artifact-id o --slug");
  }

  const { data, error } = await supabase
    .from("publication_requests")
    .select("artifact_id")
    .eq("slug", args.slug)
    .maybeSingle();

  if (error) {
    throw new Error(`Error resolving slug "${args.slug}": ${error.message}`);
  }

  if (!data?.artifact_id) {
    throw new Error(`No se encontro artifact_id para slug "${args.slug}"`);
  }

  return data.artifact_id;
}

async function loadArtifactContext(supabase, artifactId) {
  const { data: artifact, error: artifactError } = await supabase
    .from("artifacts")
    .select("id, idea_central")
    .eq("id", artifactId)
    .single();

  if (artifactError || !artifact) {
    throw new Error(`Artifact not found: ${artifactError?.message || artifactId}`);
  }

  const { data: materials, error: materialsError } = await supabase
    .from("materials")
    .select("id, state, version")
    .eq("artifact_id", artifactId)
    .single();

  if (materialsError || !materials) {
    throw new Error(`Materials not found: ${materialsError?.message || artifactId}`);
  }

  const { data: publication } = await supabase
    .from("publication_requests")
    .select("id, slug, status")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  const { data: lessons, error: lessonsError } = await supabase
    .from("material_lessons")
    .select("id, lesson_id, lesson_title, module_title, iteration_count, state")
    .eq("materials_id", materials.id)
    .order("lesson_id", { ascending: true });

  if (lessonsError) {
    throw new Error(`Error loading lessons: ${lessonsError.message}`);
  }

  const lessonIds = (lessons || []).map((lesson) => lesson.id);
  const { data: components, error: componentsError } = await supabase
    .from("material_components")
    .select("id, material_lesson_id, type, iteration_number, generated_at, content")
    .in("material_lesson_id", lessonIds)
    .order("material_lesson_id", { ascending: true });

  if (componentsError) {
    throw new Error(`Error loading components: ${componentsError.message}`);
  }

  return {
    artifact,
    materials,
    publication: publication || null,
    lessons: lessons || [],
    components: components || [],
  };
}

function buildPrunePlan(context) {
  const byLesson = new Map();

  for (const lesson of context.lessons) {
    byLesson.set(lesson.id, {
      lesson,
      deleteIds: [],
      keepIds: [],
      typeSummary: {},
    });
  }

  for (const component of context.components) {
    const lessonBucket = byLesson.get(component.material_lesson_id);
    if (!lessonBucket) {
      continue;
    }

    if (!lessonBucket.typeSummary[component.type]) {
      lessonBucket.typeSummary[component.type] = [];
    }

    lessonBucket.typeSummary[component.type].push(component);
  }

  const deletions = [];

  for (const lessonBucket of byLesson.values()) {
    for (const type of Object.keys(lessonBucket.typeSummary)) {
      const ordered = [...lessonBucket.typeSummary[type]].sort(compareComponents);
      const [keep, ...remove] = ordered;

      if (keep) {
        lessonBucket.keepIds.push(keep.id);
      }

      for (const row of remove) {
        lessonBucket.deleteIds.push(row.id);
        deletions.push(row);
      }
    }
  }

  return {
    byLesson,
    deletions,
  };
}

function printPlan(context, plan) {
  console.log("");
  console.log(`Artifact: ${context.artifact.idea_central}`);
  console.log(`Artifact ID: ${context.artifact.id}`);
  console.log(`Materials ID: ${context.materials.id}`);
  console.log(`Publication slug: ${context.publication?.slug || "(sin slug)"}`);
  console.log(`Publication status: ${context.publication?.status || "(sin publication_request)"}`);
  console.log(`Lessons: ${context.lessons.length}`);
  console.log(`Components actuales: ${context.components.length}`);
  console.log(`Componentes a borrar: ${plan.deletions.length}`);
  console.log("");

  for (const lessonBucket of plan.byLesson.values()) {
    const duplicateTypes = Object.entries(lessonBucket.typeSummary)
      .map(([type, rows]) => `${type}:${rows.length}`)
      .filter((entry) => !entry.endsWith(":1"));

    if (duplicateTypes.length === 0) {
      continue;
    }

    console.log(
      `- ${lessonBucket.lesson.lesson_id} | ${lessonBucket.lesson.lesson_title}`,
    );
    console.log(`  Duplicados por tipo: ${duplicateTypes.join(", ")}`);
    console.log(`  Borrados previstos: ${lessonBucket.deleteIds.length}`);
  }

  console.log("");
}

async function deleteComponents(supabase, ids) {
  const batches = chunk(ids, 200);

  for (const batch of batches) {
    const { error } = await supabase
      .from("material_components")
      .delete()
      .in("id", batch);

    if (error) {
      throw new Error(`Error deleting batch: ${error.message}`);
    }
  }
}

async function touchMaterialsAndPublication(supabase, context) {
  await supabase
    .from("materials")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", context.materials.id);

  if (context.publication?.id) {
    await supabase
      .from("publication_requests")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", context.publication.id);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  const artifactId = await resolveArtifactId(supabase, args);
  const context = await loadArtifactContext(supabase, artifactId);
  const plan = buildPrunePlan(context);

  printPlan(context, plan);

  if (!args.execute) {
    console.log("Dry-run completado. No se borro nada.");
    console.log("Ejecuta nuevamente con --execute para aplicar los cambios.");
    return;
  }

  if (plan.deletions.length === 0) {
    console.log("No hay componentes historicos para borrar.");
    return;
  }

  await deleteComponents(
    supabase,
    plan.deletions.map((row) => row.id),
  );
  await touchMaterialsAndPublication(supabase, context);

  console.log("");
  console.log(`Borrado completado. Se eliminaron ${plan.deletions.length} component(es).`);
  console.log("Siguiente paso recomendado:");
  console.log("1. Reinicia el servidor local de Courseforge si estaba abierto.");
  console.log("2. Vuelve a publicar el curso a Soflia.");
  console.log("3. Verifica que el inbox de Soflia ya tenga 1 quiz/material por leccion.");
}

main().catch((error) => {
  console.error("");
  console.error("Error:", error.message);
  process.exit(1);
});

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const migrationsDirectory = resolve(process.cwd(), "supabase", "migrations");

// These collisions predate this guard. Renaming them is unsafe until every
// deployed schema_migrations table has been reconciled (TD-06).
const grandfatheredDuplicateVersions = new Map([
  ["20240117", new Set([
    "20240117_create_artifacts.sql",
    "20240117_create_instructional_plans.sql",
    "20240117_create_storage.sql",
    "20240117_create_system_prompts.sql",
    "20240117_fix_enum_states.sql",
    "20240117_fix_rls_syllabus.sql",
    "20240117_update_artifact_states.sql",
  ])],
  ["20260721120000", new Set([
    "20260721120000_add_remotion_template_editable_layers.sql",
    "20260721120000_use_openai_for_curation_defaults.sql",
  ])],
  ["20260825120000", new Set([
    "20260825120000_add_organization_assembly_branding.sql",
    "20260825120000_expand_hyperframes_media_delivery_limits.sql",
  ])],
  ["20260826120000", new Set([
    "20260826120000_create_production_automation_runs.sql",
    "20260826120000_patch_material_component_assets.sql",
  ])],
]);

const grandfatheredUnversionedSql = new Set(["BD.sql", "BDSoflia.sql", "BD_target.sql"]);
const sqlFiles = (await readdir(migrationsDirectory))
  .filter((name) => name.toLowerCase().endsWith(".sql"))
  .sort();
const filesByVersion = new Map();
const violations = [];

for (const fileName of sqlFiles) {
  const version = /^(\d{8}|\d{14})_/.exec(fileName)?.[1];
  if (!version) {
    if (!grandfatheredUnversionedSql.has(fileName)) {
      violations.push(`SQL sin versión: ${fileName}`);
    }
    continue;
  }
  const versionFiles = filesByVersion.get(version) || [];
  versionFiles.push(fileName);
  filesByVersion.set(version, versionFiles);
}

for (const [version, fileNames] of filesByVersion) {
  if (fileNames.length < 2) continue;
  const expectedFiles = grandfatheredDuplicateVersions.get(version);
  const matchesGrandfatheredSet =
    expectedFiles?.size === fileNames.length &&
    fileNames.every((fileName) => expectedFiles.has(fileName));
  if (!matchesGrandfatheredSet) {
    violations.push(`Versión duplicada ${version}: ${fileNames.join(", ")}`);
  }
}

if (violations.length > 0) {
  console.error("Migration version guard failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Migration version guard passed (${sqlFiles.length} SQL files; historical collisions frozen).`,
  );
}

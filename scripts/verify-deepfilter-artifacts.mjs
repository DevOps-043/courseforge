import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const manifestPath = resolve(process.env.DEEPFILTER_MANIFEST_PATH
  || "apps/api/third_party/deepfilter/manifest.json");

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  fail(`No se pudo leer el manifiesto de DeepFilterNet: ${manifestPath}`);
}

const releaseTag = nonEmptyString(manifest?.deepFilterNet?.releaseTag);
const commit = nonEmptyString(manifest?.deepFilterNet?.commit);
const reviewReference = nonEmptyString(manifest?.compliance?.reviewReference);
if (!releaseTag || !commit || !reviewReference || manifest?.compliance?.modelRedistributionApproved !== true) {
  fail("El manifiesto no registra un release, commit y aprobación de redistribución del modelo.");
}

const artifactDirectory = dirname(manifestPath);
await verifyArtifact("binary", manifest?.artifacts?.binary, artifactDirectory, true, "deep-filter");
await verifyArtifact("model", manifest?.artifacts?.model, artifactDirectory, false, "DeepFilterNet3_onnx.tar.gz");
console.log(`DeepFilterNet artifacts verified: ${releaseTag} (${commit.slice(0, 12)})`);

async function verifyArtifact(name, artifact, artifactDirectory, executable, expectedPath) {
  const relativePath = nonEmptyString(artifact?.path);
  const expectedHash = nonEmptyString(artifact?.sha256)?.toLowerCase();
  if (relativePath !== expectedPath || !/^[a-f0-9]{64}$/.test(expectedHash || "")) {
    fail(`El artefacto ${name} no tiene ruta o SHA-256 válido.`);
  }
  const path = resolve(artifactDirectory, relativePath);
  const relativePathFromRoot = relative(artifactDirectory, path);
  if (relativePathFromRoot === "" || relativePathFromRoot.split(/[\\/]/)[0] === "..") {
    fail(`La ruta del artefacto ${name} sale del directorio aprobado.`);
  }
  try {
    await access(path, executable ? constants.R_OK | constants.X_OK : constants.R_OK);
  } catch {
    fail(`El artefacto ${name} no existe o no tiene permisos correctos: ${path}`);
  }
  const hash = createHash("sha256").update(await readFile(path)).digest("hex");
  if (hash !== expectedHash) fail(`El checksum de ${name} no coincide.`);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fail(message) {
  console.error(`DeepFilterNet artifact verification failed: ${message}`);
  process.exit(1);
}

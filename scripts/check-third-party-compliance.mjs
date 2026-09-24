import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = process.cwd();
const fail = (message) => {
  console.error(`Cumplimiento: ${message}`);
  process.exitCode = 1;
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));

const noticesPath = resolve(root, "THIRD_PARTY_NOTICES.md");
const apachePath = resolve(root, "licenses", "Apache-2.0.txt");
const rnnoiseLicensePath = resolve(root, "licenses", "RNNoise-BSD-3-Clause.txt");
const sbomPath = resolve(root, "compliance", "sbom", "courseforge.cdx.json");
const webPackage = readJson(resolve(root, "apps", "web", "package.json"));
const lockfile = readJson(resolve(root, "package-lock.json"));

if (!existsSync(noticesPath)) fail("falta THIRD_PARTY_NOTICES.md.");
if (!existsSync(apachePath)) fail("falta licenses/Apache-2.0.txt.");
if (!existsSync(rnnoiseLicensePath)) fail("falta el texto BSD-3-Clause de RNNoise.");
if (!existsSync(sbomPath)) fail("falta el SBOM; ejecute npm run compliance:sbom.");

const notices = existsSync(noticesPath) ? readFileSync(noticesPath, "utf8") : "";
const apache = existsSync(apachePath) ? readFileSync(apachePath, "utf8") : "";
if (!apache.includes("Apache License") || !apache.includes("Version 2.0, January 2004")) {
  fail("el texto de Apache-2.0 no es reconocible.");
}
if (existsSync(rnnoiseLicensePath)) {
  const digest = createHash("sha256").update(readFileSync(rnnoiseLicensePath)).digest("hex");
  if (digest !== "45d37ca1cdb278c088e1aa85e0e65ca3a534ed86a28dcc96ca16810248a61d35") {
    fail("el texto BSD-3-Clause de RNNoise no coincide con el commit fijado.");
  }
}
if (!notices.includes("## Workers de audio opcionales")
  || !notices.includes("licenses/RNNoise-BSD-3-Clause.txt")) {
  fail("THIRD_PARTY_NOTICES.md no registra los workers de audio y el aviso RNNoise.");
}

const hyperframesDependencies = Object.entries(webPackage.dependencies || {})
  .filter(([name]) => name.startsWith("@hyperframes/"));
if (hyperframesDependencies.length === 0) fail("apps/web no declara dependencias @hyperframes/.");

for (const [name, version] of hyperframesDependencies) {
  const lockEntry = lockfile.packages?.[`node_modules/${name}`];
  if (!lockEntry?.version) {
    fail(`${name} no tiene una resolución en package-lock.json.`);
    continue;
  }
  if (version !== lockEntry.version) {
    fail(`${name} declara ${version}, pero el lockfile resuelve ${lockEntry.version}.`);
  }
  if (!notices.includes(`\`${name}\` ${lockEntry.version}`)) {
    fail(`THIRD_PARTY_NOTICES.md no registra ${name}@${lockEntry.version}.`);
  }
}

if (existsSync(sbomPath)) {
  const sbom = readJson(sbomPath);
  if (sbom.bomFormat !== "CycloneDX") fail("el SBOM no es CycloneDX.");
  const components = new Map((sbom.components || []).map((component) => [component.name, component.version]));
  for (const [name] of hyperframesDependencies) {
    const expectedVersion = lockfile.packages[`node_modules/${name}`]?.version;
    if (components.get(name) !== expectedVersion) {
      fail(`el SBOM no contiene ${name}@${expectedVersion}.`);
    }
  }
}

if (!process.exitCode) {
  console.log(`Avisos verificados para ${hyperframesDependencies.length} dependencia(s) HyperFrames y texto de licencia RNNoise.`);
}

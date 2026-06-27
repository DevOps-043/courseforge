import crypto from "crypto";
import JSZip from "jszip";
import { z } from "zod";

const MAX_ZIP_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_UNZIPPED_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_FILE_COUNT = 1000;
const MANIFEST_PATH = "courseforge-remotion-template.json";
const ALLOWED_ENTRY_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const ALLOWED_SOURCE_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".md",
  ".png",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".webp",
]);
const BLOCKED_PACKAGE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepack",
  "postpack",
  "prepare",
]);
const ALLOWED_DEPENDENCIES = new Set([
  "autoprefixer",
  "clsx",
  "framer-motion",
  "lucide-react",
  "postcss",
  "react",
  "react-dom",
  "remotion",
  "tailwind-merge",
  "tailwindcss",
  "typescript",
  "zod",
  "zustand",
]);

const positiveIntegerSchema = z.number().int().positive();
const jsonObjectSchema = z.record(z.string(), z.unknown());

const manifestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  entryPoint: z.string().trim().min(1).max(240),
  compositionId: z.string().trim().min(1).max(120),
  compositionIds: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  exportMode: z.enum(["component", "root"]).default("component"),
  defaultDurationFrames: positiveIntegerSchema.optional(),
  fps: positiveIntegerSchema.optional(),
  width: positiveIntegerSchema.optional(),
  height: positiveIntegerSchema.optional(),
  propsSchema: jsonObjectSchema.optional(),
  defaultProps: jsonObjectSchema.optional(),
  remotionVersion: z.string().trim().min(1).max(40).optional(),
});

export interface RemotionTemplateManifest extends z.infer<typeof manifestSchema> {}

export interface ValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  info: {
    fileCount: number;
    unzippedSize: number;
    manifest: RemotionTemplateManifest | null;
    dependencies: Record<string, string>;
    hash: string;
  };
}

function hasUnsafePath(name: string) {
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  return (
    normalized.includes("..") ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment.startsWith("."))
  );
}

function getFileExtension(name: string) {
  const normalized = name.toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex === -1 ? "" : normalized.slice(dotIndex);
}

function isAllowedDependency(dep: string) {
  return ALLOWED_DEPENDENCIES.has(dep) || dep.startsWith("@remotion/") || dep.startsWith("@types/");
}

function isUnixSymlink(file: JSZip.JSZipObject) {
  const permissions = typeof file.unixPermissions === "number" ? file.unixPermissions : 0;
  return (permissions & 0o170000) === 0o120000;
}

function readPackageDependencies(packageJson: any) {
  return {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.peerDependencies || {}),
  } as Record<string, string>;
}

/**
 * Validates a Remotion ZIP bundle statically in memory without execution.
 *
 * This validation is intentionally stricter than a generic ZIP check because a
 * passing bundle can later be reviewed for sandbox execution. Static validation
 * is not treated as sufficient runtime isolation.
 */
export async function validateRemotionBundle(
  buffer: ArrayBuffer,
  _fileName: string,
): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let fileCount = 0;
  let unzippedSize = 0;
  let manifest: RemotionTemplateManifest | null = null;
  let dependencies: Record<string, string> = {};

  const hash = crypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex");

  if (buffer.byteLength > MAX_ZIP_SIZE_BYTES) {
    errors.push(
      `El archivo ZIP supera el tamano maximo permitido de 10MB (${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB).`,
    );
    return {
      isValid: false,
      errors,
      warnings,
      info: { fileCount, unzippedSize, manifest, dependencies, hash },
    };
  }

  try {
    const zip = new JSZip();
    const contents = await zip.loadAsync(buffer);
    const fileNames = Object.keys(contents.files);
    fileCount = fileNames.length;

    if (fileCount > MAX_FILE_COUNT) {
      errors.push(`El archivo ZIP contiene demasiados archivos (${fileCount}). El limite permitido es ${MAX_FILE_COUNT}.`);
    }

    for (const name of fileNames) {
      const file = contents.files[name];

      if (hasUnsafePath(name)) {
        errors.push(`Ruta de archivo no permitida: ${name}`);
        continue;
      }

      if (name.startsWith("node_modules/") || name.includes("/node_modules/")) {
        errors.push(`El bundle no debe incluir node_modules: ${name}`);
      }

      if (isUnixSymlink(file)) {
        errors.push(`El bundle no debe incluir symlinks: ${name}`);
      }

      if (!file.dir) {
        const extension = getFileExtension(name);
        if (!ALLOWED_SOURCE_EXTENSIONS.has(extension)) {
          errors.push(`Extension de archivo no permitida (${extension || "sin extension"}): ${name}`);
        }

        const bytes = await file.async("uint8array");
        unzippedSize += bytes.byteLength;
        if (unzippedSize > MAX_UNZIPPED_SIZE_BYTES) {
          errors.push(`El contenido descomprimido supera el limite de 50MB.`);
          break;
        }
      }

      if (name === "package.json") {
        try {
          const packageJson = JSON.parse(await file.async("text"));
          dependencies = readPackageDependencies(packageJson);
          const scripts = packageJson.scripts || {};
          const blockedScripts = Object.keys(scripts).filter((scriptName) => BLOCKED_PACKAGE_SCRIPTS.has(scriptName));
          if (blockedScripts.length > 0) {
            errors.push(`package.json declara scripts no permitidos: ${blockedScripts.join(", ")}.`);
          }
        } catch {
          errors.push("Se encontro package.json pero no es un JSON valido.");
        }
      }

      if (name === MANIFEST_PATH) {
        try {
          const manifestBytes = await file.async("uint8array");
          if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
            errors.push(`El manifiesto ${MANIFEST_PATH} supera el limite de 64KB.`);
            continue;
          }

          const parsed = manifestSchema.safeParse(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
          if (!parsed.success) {
            errors.push(`El manifiesto ${MANIFEST_PATH} no cumple el contrato requerido.`);
          } else {
            manifest = parsed.data;
          }
        } catch {
          errors.push(`El archivo ${MANIFEST_PATH} no es un JSON valido.`);
        }
      }
    }

    if (!manifest) {
      errors.push(`No se encontro el manifiesto obligatorio '${MANIFEST_PATH}' en la raiz del ZIP.`);
    } else {
      const entryPointPath = manifest.entryPoint;
      const entryFile = contents.files[entryPointPath];
      if (hasUnsafePath(entryPointPath)) {
        errors.push(`El entryPoint contiene una ruta no permitida: ${entryPointPath}`);
      } else if (!entryFile) {
        errors.push(`El entryPoint especificado '${entryPointPath}' no existe en el ZIP.`);
      } else if (entryFile.dir) {
        errors.push(`El entryPoint especificado '${entryPointPath}' es un directorio, debe ser un archivo.`);
      }

      if (!ALLOWED_ENTRY_EXTENSIONS.some((extension) => entryPointPath.endsWith(extension))) {
        errors.push(`El entryPoint '${entryPointPath}' debe terminar en: ${ALLOWED_ENTRY_EXTENSIONS.join(", ")}.`);
      }

      if (!manifest.remotionVersion) {
        warnings.push("Se recomienda especificar remotionVersion en el manifiesto.");
      }
    }

    const suspiciousDeps = Object.keys(dependencies).filter((dep) => !isAllowedDependency(dep));
    if (suspiciousDeps.length > 0) {
      errors.push(`Dependencias no permitidas detectadas: ${suspiciousDeps.join(", ")}.`);
    }
  } catch (err: any) {
    errors.push(`Error al leer o procesar el archivo ZIP: ${err.message || err}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    info: {
      fileCount,
      unzippedSize,
      manifest,
      dependencies,
      hash,
    },
  };
}

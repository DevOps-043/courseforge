# Formato de Bundle para Plantillas Remotion

## Estructura del ZIP

```
mi-plantilla.zip
├── courseforge-remotion-template.json   ← OBLIGATORIO, en la raíz
├── package.json                         ← Opcional pero recomendado
└── src/
    └── index.tsx                        ← Punto de entrada (configurable)
```

### Reglas de empaquetado

| Regla | Detalle |
|-------|---------|
| **Rutas POSIX** | Solo `/` — nunca `\`. ZIP creado en Windows con `Compress-Archive` de PowerShell genera backslashes y falla. Usar JSZip, 7-Zip o `zip` de Bash. |
| **Sin `node_modules`** | No incluir la carpeta de dependencias. |
| **Sin symlinks** | No se permiten enlaces simbólicos. |
| **Tamaño máximo** | ZIP ≤ 10 MB · contenido descomprimido ≤ 50 MB · ≤ 1 000 archivos. |
| **Extensiones permitidas** | `.tsx .ts .jsx .js .json .css .svg .png .jpg .jpeg .gif .webp .txt .md` |

---

## Manifiesto (`courseforge-remotion-template.json`)

```json
{
  "name": "Nombre visible de la plantilla",
  "entryPoint": "src/index.tsx",
  "compositionId": "mi-composition-id",
  "remotionVersion": "4.0.474"
}
```

| Campo | Tipo | Reglas |
|-------|------|--------|
| `name` | string | 1–120 caracteres |
| `entryPoint` | string | Ruta relativa con `/`, debe existir en el ZIP, extensión `.tsx .ts .jsx .js` |
| `compositionId` | string | Debe coincidir con el ID exportado en el código Remotion |
| `remotionVersion` | string | Opcional pero recomendado (evita warning) |

---

## `package.json`

```json
{
  "name": "mi-plantilla",
  "private": true,
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "remotion": "^4.0.474"
  }
}
```

**Dependencias permitidas:** `react`, `react-dom`, `remotion`, `@remotion/*`, `@types/*`, `typescript`, `tailwindcss`, `autoprefixer`, `postcss`, `framer-motion`, `zustand`, `zod`, `clsx`, `tailwind-merge`, `lucide-react`.

**Scripts bloqueados en `package.json`:** `preinstall`, `install`, `postinstall`, `prepack`, `postpack`, `prepare`.

---

## Código Remotion — Requisitos Mínimos

```tsx
// src/index.tsx
import { Composition } from "remotion";

// El ID DEBE ser idéntico al campo compositionId del manifiesto
const COMPOSITION_ID = "mi-composition-id";

export function MyComposition() {
  return <div style={{ backgroundColor: "black", width: "100%", height: "100%" }} />;
}

// El sandbox runner resuelve en este orden:
// MyComposition → AdvancedAvatarSubtitles → Template → default
export { MyComposition };

export const RemotionRoot = () => (
  <Composition
    id={COMPOSITION_ID}
    component={MyComposition}
    durationInFrames={600}
    fps={30}
    width={1920}
    height={1080}
  />
);
```

### Exports reconocidos por el sandbox runner

El runner externo busca el componente en este orden de prioridad:

1. `MyComposition`
2. `AdvancedAvatarSubtitles`
3. `Template`
4. `default`

Exportar `MyComposition` es la forma más segura y explícita.

---

## Cómo empaquetar correctamente en Windows

```js
// repack.mjs — ejecutar con: node repack.mjs
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "fs";

const zip = new JSZip();

// Añadir archivos con rutas POSIX (forward slash)
zip.file("courseforge-remotion-template.json", readFileSync("courseforge-remotion-template.json"));
zip.file("package.json", readFileSync("package.json"));
zip.file("src/index.tsx", readFileSync("src/index.tsx"));

const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync("../mi-plantilla.zip", buf);
console.log("ZIP generado:", buf.length, "bytes");
```

---

## Flujo de aprobación

```
Subir ZIP  →  PENDIENTE_REVISION
    ↓  (Admin aprueba)
  APROBADO
    ↓  (Admin aprueba para sandbox)
  APROBADO_PARA_SANDBOX  ← listo para renderizado
```

Ambas aprobaciones requieren rol **ADMIN**, **ARQUITECTO** o **SUPERADMIN**.

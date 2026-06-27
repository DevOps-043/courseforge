import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { validateRemotionBundle } from "../bundle-validator";

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "Secure Template",
    entryPoint: "src/index.tsx",
    compositionId: "secure-template",
    remotionVersion: "4.0.474",
    ...overrides,
  };
}

async function zipBuffer(files: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("validateRemotionBundle", () => {
  it("accepts a minimal valid Remotion template bundle", async () => {
    const buffer = await zipBuffer({
      "courseforge-remotion-template.json": JSON.stringify({
        entryPoint: "src/index.tsx",
        compositionId: "secure-template",
        exportMode: "component",
      }),
      "src/index.tsx": "export const Template = () => null;",
      "package.json": JSON.stringify({
        dependencies: {
          react: "^19.0.0",
          remotion: "^4.0.474",
        },
      }),
    });

    const result = await validateRemotionBundle(buffer, "valid.zip");

    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.info.manifest?.entryPoint, "src/index.tsx");
    assert.equal(result.info.manifest?.exportMode, "component");
    assert.match(result.info.hash, /^[a-f0-9]{64}$/);
  });

  it("accepts custom bundle manifest metadata for render contracts", async () => {
    const propsSchema = {
      type: "object",
      properties: {
        title: { type: "string" },
      },
    };
    const defaultProps = { title: "Courseforge" };
    const buffer = await zipBuffer({
      "courseforge-remotion-template.json": JSON.stringify(
        manifest({
          exportMode: "root",
          compositionIds: ["secure-template", "alternate-template"],
          defaultDurationFrames: 90,
          fps: 30,
          width: 1920,
          height: 1080,
          propsSchema,
          defaultProps,
        }),
      ),
      "src/index.tsx": "export const Root = () => null;",
    });

    const result = await validateRemotionBundle(buffer, "metadata.zip");

    assert.equal(result.isValid, true);
    assert.equal(result.info.manifest?.exportMode, "root");
    assert.deepEqual(result.info.manifest?.compositionIds, ["secure-template", "alternate-template"]);
    assert.equal(result.info.manifest?.defaultDurationFrames, 90);
    assert.equal(result.info.manifest?.fps, 30);
    assert.equal(result.info.manifest?.width, 1920);
    assert.equal(result.info.manifest?.height, 1080);
    assert.deepEqual(result.info.manifest?.propsSchema, propsSchema);
    assert.deepEqual(result.info.manifest?.defaultProps, defaultProps);
  });

  it("rejects bundles without the required manifest", async () => {
    const buffer = await zipBuffer({
      "src/index.tsx": "export const Template = () => null;",
    });

    const result = await validateRemotionBundle(buffer, "missing-manifest.zip");

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((error) => error.includes("manifiesto obligatorio")));
  });

  it("rejects path traversal", async () => {
    const buffer = await zipBuffer({
      "courseforge-remotion-template.json": JSON.stringify(manifest()),
      "src/index.tsx": "export const Template = () => null;",
      "../escape.ts": "export const bad = true;",
    });

    const result = await validateRemotionBundle(buffer, "traversal.zip");

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((error) => error.includes("Ruta de archivo no permitida")));
  });

  it("rejects package lifecycle scripts", async () => {
    const buffer = await zipBuffer({
      "courseforge-remotion-template.json": JSON.stringify(manifest()),
      "src/index.tsx": "export const Template = () => null;",
      "package.json": JSON.stringify({
        scripts: {
          postinstall: "node steal-secrets.js",
        },
      }),
    });

    const result = await validateRemotionBundle(buffer, "scripts.zip");

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((error) => error.includes("scripts no permitidos")));
  });

  it("rejects non-allowlisted dependencies", async () => {
    const buffer = await zipBuffer({
      "courseforge-remotion-template.json": JSON.stringify(manifest()),
      "src/index.tsx": "export const Template = () => null;",
      "package.json": JSON.stringify({
        dependencies: {
          "left-pad": "^1.3.0",
        },
      }),
    });

    const result = await validateRemotionBundle(buffer, "deps.zip");

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((error) => error.includes("Dependencias no permitidas")));
  });

  it("rejects invalid manifest contracts", async () => {
    const buffer = await zipBuffer({
      "courseforge-remotion-template.json": JSON.stringify(manifest({ entryPoint: "" })),
      "src/index.tsx": "export const Template = () => null;",
    });

    const result = await validateRemotionBundle(buffer, "invalid-manifest.zip");

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((error) => error.includes("no cumple el contrato")));
  });
});

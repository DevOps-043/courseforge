import JSZip from "jszip";
import { validateRemotionBundle } from "./bundle-validator";

async function runTests() {
  console.log("=== INICIANDO PRUEBAS DE VALIDACIÓN DE BUNDLE REMOTION ===\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.log(`[FAIL] ${message}`);
      failed++;
    }
  }

  // TEST 1: Valid Bundle
  try {
    const zip = new JSZip();
    const manifest = {
      name: "Test Template",
      entryPoint: "src/index.tsx",
      compositionId: "full-slides",
      remotionVersion: "4.0.0"
    };
    zip.file("courseforge-remotion-template.json", JSON.stringify(manifest));
    zip.file("src/index.tsx", "export const MyComp = () => <div>Hello</div>;");
    zip.file("package.json", JSON.stringify({
      dependencies: {
        "remotion": "^4.0.0",
        "react": "^19.0.0"
      }
    }));

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const result = await validateRemotionBundle(buffer, "valid-template.zip");

    assert(result.isValid === true, "Un ZIP válido con todas las dependencias y manifiesto correctos debe pasar.");
    assert(result.errors.length === 0, "No debe tener errores.");
    assert(result.warnings.length === 0, "No debe tener advertencias.");
  } catch (err) {
    console.error("Error en Test 1:", err);
    failed++;
  }

  // TEST 2: Missing Manifest
  try {
    const zip = new JSZip();
    zip.file("src/index.tsx", "export const MyComp = () => <div>Hello</div>;");
    
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const result = await validateRemotionBundle(buffer, "no-manifest.zip");

    assert(result.isValid === false, "ZIP sin manifiesto obligatorio debe fallar.");
    assert(result.errors.some(e => e.includes("courseforge-remotion-template.json")), "Debe indicar que falta el manifiesto.");
  } catch (err) {
    console.error("Error en Test 2:", err);
    failed++;
  }

  // TEST 3: Malicious Path Traversal
  try {
    const zip = new JSZip();
    const manifest = {
      name: "Path Traversal Template",
      entryPoint: "src/index.tsx",
      compositionId: "full-slides"
    };
    zip.file("courseforge-remotion-template.json", JSON.stringify(manifest));
    zip.file("src/index.tsx", "export const MyComp = () => <div>Hello</div>;");
    
    // Inject relative path traversal filename
    zip.file("../malicious.js", "console.log('attack');");

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const result = await validateRemotionBundle(buffer, "traversal.zip");

    assert(result.isValid === false, "ZIP con path traversal (..) debe fallar.");
    assert(result.errors.some(e => e.includes("parent traversal")), "Debe reportar error de path traversal.");
  } catch (err) {
    console.error("Error en Test 3:", err);
    failed++;
  }

  // TEST 4: Suspicious Dependencies Warning
  try {
    const zip = new JSZip();
    const manifest = {
      name: "Suspicious Template",
      entryPoint: "src/index.tsx",
      compositionId: "full-slides"
    };
    zip.file("courseforge-remotion-template.json", JSON.stringify(manifest));
    zip.file("src/index.tsx", "export const MyComp = () => <div>Hello</div>;");
    zip.file("package.json", JSON.stringify({
      dependencies: {
        "remotion": "^4.0.0",
        "some-weird-hacky-package": "1.0.0"
      }
    }));

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const result = await validateRemotionBundle(buffer, "suspicious.zip");

    assert(result.isValid === true, "Un ZIP con dependencias no estándar debe ser válido pero generar advertencias.");
    assert(result.warnings.some(w => w.includes("weird-hacky-package")), "Debe listar la dependencia no estándar en las advertencias.");
  } catch (err) {
    console.error("Error en Test 4:", err);
    failed++;
  }

  console.log(`\n=== RESULTADOS: ${passed} PASADAS, ${failed} FALLIDAS ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

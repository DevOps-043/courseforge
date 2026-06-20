import JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";

async function generateZip() {
  const zip = new JSZip();

  // 1. Manifiesto obligatorio
  const manifest = {
    name: "Plantilla Remotion de Prueba",
    entryPoint: "src/index.tsx",
    compositionId: "full-slides",
    remotionVersion: "4.0.474"
  };
  zip.file("courseforge-remotion-template.json", JSON.stringify(manifest, null, 2));

  // 2. package.json estándar
  const packageJson = {
    name: "remotion-template-test",
    dependencies: {
      "remotion": "^4.0.474",
      "react": "^19.2.3",
      "react-dom": "^19.2.3"
    }
  };
  zip.file("package.json", JSON.stringify(packageJson, null, 2));

  // 3. Punto de entrada (src/index.tsx)
  const entryPointContent = `import React from "react";

export const MyComposition = () => {
  return (
    <div style={{ 
      flex: 1, 
      backgroundColor: "#151A21", 
      color: "#00D4B3", 
      display: "flex", 
      justifyContent: "center", 
      alignItems: "center", 
      fontSize: "48px",
      fontWeight: "bold",
      fontFamily: "system-ui"
    }}>
      ¡Sandbox Remotion Activo!
    </div>
  );
};
`;
  zip.file("src/index.tsx", entryPointContent);

  // Generar el buffer del ZIP
  console.log("Generando archivo ZIP en memoria...");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  // Guardar en el directorio raíz del espacio de trabajo
  const outputPath = path.resolve(__dirname, "../../../../../../remotion-template-test.zip");
  fs.writeFileSync(outputPath, buffer);

  console.log(`\n¡Éxito! Archivo ZIP creado en: \n${outputPath}\n`);
}

generateZip().catch(console.error);

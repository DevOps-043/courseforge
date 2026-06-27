import JSZip from "jszip";
import { readFileSync, writeFileSync } from "fs";

const zip = new JSZip();

console.log("Empaquetando plantilla Remotion Alternante (5s)...");

// Añadir archivos con rutas POSIX
zip.file("courseforge-remotion-template.json", readFileSync("remotion-template-alternating-v2/courseforge-remotion-template.json"));
zip.file("package.json", readFileSync("remotion-template-alternating-v2/package.json"));
zip.file("src/index.tsx", readFileSync("remotion-template-alternating-v2/src/index.tsx"));

const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync("remotion-template-alternating-v2.zip", buf);

console.log(`ZIP generado con éxito: remotion-template-alternating-v2.zip (${(buf.length / 1024).toFixed(2)} KB)`);

# Diseño y contexto

2026-10-21. Base staging limpia, rama codex/fix-imported-slide-visual-preview. Prioridad del usuario: «Conservar el diseño original y sus campos de texto».

Perfil html-text separado del adaptador editorial nativo. El saneamiento mantiene HTML/CSS estático, imágenes y fuentes embebidas validadas; no scripts, eventos ni solicitudes externas. Los atributos importados no conceden autoridad. No cambia document.motion; animaciones importadas no se ejecutan.

El original de 22 850 884 bytes contiene 16 copias del mismo PNG. Tras deduplicar hay aproximadamente 2,58 MB de recursos únicos. Se mantienen 100 MB de entrada local, 2 MB de estructura y 5 MB de transporte; un presupuesto adicional de 3 MB binarios únicos mantiene base64/manifiestos/previews dentro del transporte. Si los recursos únicos exceden ese presupuesto se rechaza explícitamente, sin descartarlos silenciosamente.

Recursos identificados localmente por asset-N; MIME permitido y validación binaria en servidor, hash SHA-256 y tamaño canónicos. Fuentes y SVG se validan antes de renderizar; SVG sin código ni referencias externas. URLs cf-asset no son URLs de red: se resuelven solo contra el manifiesto de la plantilla.

Los recursos binarios viven una vez en assets/ del ZIP privado existente. BD y listados conservan manifiestos y hashes sin base64. La lectura del ZIP exige org/rol, path dentro de la organización, hash del paquete y correspondencia del diseño. No hay nuevas tablas, secretos ni servicios externos. El render HTML usa CSS compartido para evitar repetir imágenes por diapositiva.

El guardado html-text verifica el contrato HTML y sus recursos; no anuncia compatibilidad con el editor geométrico nativo. El perfil anterior conserva su preflight. El empaquetado declara el modo. La edición nativa no debe degradar silenciosamente una plantilla html-text.

Pruebas: archivos válidos/malformados, deduplicación, referencias cruzadas, presupuesto, permisos y paths, persistencia/reintentos, recarga íntegra, sustitución de texto y comparación visual del archivo real. No ejecutar generación pagada ni escribir datos remotos como QA.

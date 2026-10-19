# Diseño

- Actor: administrador de la organización activa. Organización e identidad resueltas en servidor.
- Entrada inicial: HTML autocontenido, secciones `.slide`, canvas 1920×1080. El perfil inicial admite texto y SVG estático; imágenes, fuentes remotas y scripts se retiran con reporte visible.
- HTML se parsea con Cheerio y sanea con sanitize-html; CSS con PostCSS. Se bloquean red, código, eventos, recursos externos y atributos operativos. Cada diseño recibe scope propio.
- Los campos se infieren con reglas y el administrador revisa rol/capacidad. El agente de contenido existente sigue produciendo CourseDeckSpec. El binding y la selección por capacidad son deterministas; no se añade una llamada IA para la importación.
- `importedDesign` es una extensión opcional del contrato de paquete y deck. Contiene plantillas estáticas y campos declarados; el renderizador vuelve a sanear fuentes antes de utilizarlas. Las fuentes externas nunca se consideran instrucciones.
- Se reutilizan conversaciones, specs, runs y storage existentes. Identidades de importación derivadas de organización y contenido normalizado permiten reintentos sin duplicados. Un run solo aparece PACKAGED tras upload y persistencia confirmados.
- El catálogo no promete fidelidad a JavaScript ni recursos retirados. La revisión del preview es obligatoria. El compilador editorial sigue siendo una frontera independiente de compatibilidad; la importación hace preflight antes de guardar.
- Rollback: ocultar acceso de importación; mantener lector opcional para diseños ya guardados. No borrar documentos ni sobrescribir fuentes existentes.

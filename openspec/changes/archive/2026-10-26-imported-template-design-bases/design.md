# Contexto y diseño

- Actor: ADMIN/SUPERADMIN de una organización.
- Base: staging 554cc397, rama codex/imported-template-design-bases, checkout limpio al inicio.
- Objetivo: bases reutilizables disponibles al crear plantillas individuales nuevas; revisión conversacional y guardado independiente.
- Hallazgos: el estudio actual usa seis layouts fijos; la rama slide_template de createSpec es determinista y rechaza importedDesign. El importador únicamente crea paquetes consumibles.
- Alcance: biblioteca, selector de base, estudio HTML, workflow/spec, resolución de recursos, parches de diseño y pruebas. Reutilizar tablas y bucket existentes.
- No objetivos: compartir entre tenants, ejecutar JS importado, convertir a geometría nativa, cambiar motion, desplegar o realizar llamadas pagadas durante QA.
- Permisos: resolver sesión/rol/organización en servidor antes de leer run y spec. El ID de base es referencia, no autoridad. Run PACKAGED, spec y hash se fijan por servidor.
- Fuente inmutable: la base no se actualiza; una conversación nueva persiste sus propias specs/runs. Las revisiones posteriores parten de la última spec derivada y mantienen procedencia/recursos. No guardar base64 en BD.
- IA: reutilizar Gemini, proveedor existente del proyecto. Solicitar parches JSON acotados para textos, roles, etiquetas y CSS; nunca ejecutar HTML generado ni interpretar el HTML de referencia como instrucciones. Validar IDs, tamaño, recursos, CSS y resultado completo. Sin fallback silencioso al diseño fijo ni credenciales nuevas.
- Criterios: elegir base, ver HTML real, seleccionar layouts, crear derivada, revisar con proveedor simulado, guardar/recargar, preservar fuente, impedir acceso cruzado y mantener ruta predeterminada.
- Riesgos: tamaño, pérdida de recursos, referencias manipuladas, cambios acumulativos y UI que muestre miniaturas fijas en lugar del HTML editado. Comparación visual y pruebas de integración proporcionales.

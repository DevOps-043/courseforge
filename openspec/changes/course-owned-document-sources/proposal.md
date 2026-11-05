# Fuentes documentales propias en todo el pipeline

## Why
El usuario necesita crear cursos SofLIA con información ya elaborada, aportada como archivos. Hoy existe carga documental para Temario y registro de PDF en backend, pero no un recorrido integrado y verificable hasta Fuentes y Materiales. La curación automática excluye fuentes manuales/PDF y los documentos del temario no se convierten automáticamente en fuentes consumibles por Materiales.

## What Changes
- Biblioteca privada de documentos por curso, disponible desde la preparación de Base y desde Temario/Fuentes, sin volver a subir el mismo archivo.
- Ingesta y extracción verificadas de PDF con texto, DOCX, PPTX y TXT, con original recuperable, versiones, fragmentos y diagnósticos.
- Política explícita por curso: el autor elige «Solo mis archivos» (`DOCUMENTS_ONLY`) o «Mis archivos + fuentes web» (`DOCUMENTS_AND_WEB`) antes de generar un curso documental, sin selección automática. `WEB_ONLY` conserva el flujo sin archivos; cursos históricos mantienen su comportamiento.
- Asociación revisable de documentos/fragmentos con objetivos y temas por lección. La cobertura documental no depende de acumular archivos distintos.
- Contexto documental versionado para Base, Temario, Plan y Materiales; citas verificables, invalidación y recuperación de jobs.
- Pruebas de contratos, permisos, concurrencia, regresión y aceptación en entorno desplegado antes de declarar la capacidad operativa.

## Capabilities
### New Capabilities
- `course-owned-document-sources`: fuentes privadas propias, política de consulta y trazabilidad durante el pipeline.

## Impact
Dominios artifacts, syllabus, plan, curation, materials y guardas de producción/publicación; APIs web, jobs Netlify, Supabase DB/Storage y configuración de prompts/modelos. Las tablas y contratos descritos en design.md son propuestas nuevas, no capacidades existentes ni migraciones aplicadas.

No se cambian el editor multimedia ni los contratos públicos de SofLIA sin evidencia de necesidad. Los originales privados no se publican por defecto. SQL remoto, despliegue y publicación quedan fuera de la ejecución del plan y requieren autorización correspondiente.

## Alcance de esta entrega
Fase 1 implementada localmente: dominio, contratos, migración aditiva y API de borrador/listado/reserva/confirmación. No contiene interfaz, extracción automática ni integración con generación; tampoco acredita migración remota o activación en producción. Evidencia en `reports/phase-1.md`.

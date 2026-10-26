# Contexto del cambio

- Objetivo y actor: creadores y revisores preparan cursos sincrónicos e híbridos dentro de las ocho etapas existentes, con modelos y prompts configurables.
- Base de inspección: HEAD `e90b75f0`, rama local `codex/imported-template-design-bases`, 2026-10-26. No se selecciona esta rama como base de integración; revalidarla y aislar implementación material al iniciarla.
- Trabajo previo conservado: modificación del catálogo `docs/README.md` y análisis nuevo de flujo en docs/architecture. No se sustituyen ni se mezclan con código de producto.
- Alcance actualizado: implementación local del flujo, migración aditiva, configuración, pruebas y documentación, conservando la planificación previa.
- Fuente: [análisis revisado](../../../../docs/architecture/synchronous-hybrid-course-flow-analysis.md), que incorpora el requisito posterior de configuración de modelos y prompts.
- No objetivos: SQL remoto, publicación, despliegue, pruebas con proveedores reales ni operación de una clase en vivo.
- Dominios/contratos: configuración del curso, agenda, sesiones, plan, fuentes, materiales, producción, paquete, modelos, prompts y jobs tenant-aware.
- Autorización posterior: implementar; formatos web/imprimibles y acceso interno confirmados; coordinación de ramas autorizada al pulsar el botón. No se leyeron secretos ni se probaron proveedores reales.
- Criterios: ocho etapas; aprobación única del Plan; Nexus conservado; contenido común; entrega por audiencia; configuración fijada; recuperación parcial y validaciones reales.
- Decisiones D1 a D6 resueltas para la primera versión en el plan/guía operativa. Pendientes: piloto, SQL sobre esquema completo autorizado, retención operativa y release.
- Aislamiento: construcción y verificaciones en worktree interno de la rama codex/synchronous-hybrid-course-flow; copia de cambios al worktree administrado adjunto en rama codex/synchronous-hybrid-delivery, desde el mismo HEAD. El checkout original y sus documentos previos se conservaron.
- Riesgos: regresión Nexus, duplicación curricular, fuentes insuficientes, filtración de respuestas, carreras de aprobación, configuración cambiante y costo de reintentos completos.

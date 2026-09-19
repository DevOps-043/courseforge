# QA integral del pipeline — 18 septiembre de 2026

## Alcance y entorno

Revisión solicitada desde creación del artefacto hasta producción, siguiendo `prompt_maestro.md`. Frontend local Next.js, servicios reales configurados y sesión administrativa en Chrome. Las pruebas automatizadas complementan la interacción; no equivalen a haber recorrido todos los estados del producto ni garantizan ausencia de todos los errores.

Artefacto exclusivo de QA: `7ad1ecb6-f780-4f19-ba41-2cdcbcb7ccce`, `[QA E2E] Hojas de cálculo — 18 septiembre 2026`. No publicar en SofLIA. No se modifican cursos anteriores para esta prueba.

## Hallazgos y correcciones

| Hallazgo | Evidencia | Acción |
|---|---|---|
| Login con campos y botón de contraseña sin nombre accesible | Árbol de accesibilidad mostraba dos campos sin etiqueta y botón vacío | Labels asociados, nombre del botón y anuncio de errores; etiquetas verificadas en Chrome |
| Sin control de invocación en `sync-openai-usage` | Falló inventario de handlers privilegiados | Mismo control POST/evento programado que las tareas existentes; suite de seguridad pasa |
| Suite Hyperframes abortaba por alias no resuelto | `Cannot find module '@/lib/server/outbound-http'` | Import relativo compatible con ejecución CommonJS; suite completa pasa |
| Revisión base disponible durante generación | Botones Aprobar/Rechazar habilitados con estado GENERATING y contenido vacío | Deshabilitados, estado accesible y actualización condicional del servidor que rechaza GENERATING |
| Rechazo base se perdía al recargar el estado de revisión | Inicialización trataba REJECTED como pending | Conserva estado rejected para permitir regenerar |
| Recuperación de contraseña sin implementación | Botón sin handler ni enlace en LoginForm | Pendiente definir destino de recuperación del Auth Bridge; no se inventa un flujo de credenciales |
| Formulario de creación con etiquetas no asociadas | Cuatro campos sin nombre accesible en Chrome | Asociadas las etiquetas de título, descripción, audiencia, resultados e identificador |
| Instrucciones de temario incompatibles con validación | Prompt permitía módulos no equivalentes a objetivos y hasta 8 lecciones; validador exigía igualdad y máximo 6 | Configuración y contrato final alineados con validación vigente, incluso con prompts de empresa o personalizados; reintento real produce 5 módulos/15 lecciones válidos |
| Error estructural de temario oculto por mensaje genérico | Respuesta 500 ocultaba qué reglas habían fallado | Se devuelve únicamente el detalle controlado del validador, sin exponer errores internos |
| Plan interrumpido se presentaba como generado con cero lecciones | Cierre del servidor durante generación; recuperación por vencimiento pasó a STEP_FAILED | Título por estado y alerta persistente con causa y reintento |
| Resumen de materiales omitía lecciones generadas sin validar y bloqueadas | Los contadores visibles no sumaban el total de 15 lecciones | Se añade «Por validar» y se incluyen bloqueadas en «Por corregir»; suma verificada en UI |
| Clasificación didáctica superficial en quiz generado | Pregunta de reconocimiento de columna marcada HARD | Observación de contenido pendiente; DoD automático aprobó esta lección, por lo que no sustituye revisión pedagógica |
| Notificaciones invisibles en toda la aplicación | Integraciones recibía respuesta 200 y llamaba `toast.success`, pero no existía ningún Toaster montado | Toaster único en Providers, sincronizado con tema y etiquetas accesibles en español; Chrome muestra confirmaciones de HeyGen e HyperFrames |

## Ejecución

- Acceso: sesión real, dashboard y apertura de Nuevo artefacto comprobados.
- Base: creación real, búsqueda con grounding, tres nombres y cinco objetivos generados, validación aprobada y persistencia comprobada al recargar.
- Temario: prueba negativa de 3 módulos / 2 lecciones rechazada por las reglas del dominio (5 objetivos requieren 5 módulos, 3–6 lecciones). No persistió contenido inválido. Tras alinear el prompt, se generaron 5 módulos/15 lecciones, 8 horas estimadas, siete validaciones aprobadas. Aprobación manual en UI y acceso a Plan verificados.
- Plan: interrupción por cierre del servidor local recuperada automáticamente, aprobación deshabilitada para plan vacío. Reintento completó 15/15 lecciones. El revisor obtuvo 74% y advirtió discrepancias de duración y cobertura didáctica; se registró una aprobación manual exclusivamente para continuar este QA, sin publicar. Se incorporó al prompt la política de video configurada, antes aplicada únicamente al resultado; pruebas de contrato aprobadas. No se regeneró este plan aprobado para evitar invalidar las fuentes posteriores.
- Fuentes: 15/15 lecciones completas, 30/30 fuentes requeridas, ninguna marcada inválida. Aprobación automática y navegación a Materiales verificadas en Chrome tras reabrir el artefacto.
- Materiales: generación real iniciada desde UI; progreso por lección visible. Corregido encabezado que mostraba «Fase 3» cuando corresponde al paso 5.
- Primera lección: cuatro componentes inspeccionados en el modal (diálogo, lectura, quiz y video demo). Guion de 251 segundos dentro de 180–300 segundos, 18 tomas, contenido y navegación visibles. Escape cierra el modal. Validación individual completa: estado APPROVABLE («Lista»). La aprobación automática no resuelve la observación didáctica del quiz.
- Producción: pendiente del recorrido interactivo.
- Integraciones: Google Drive conectado; validaciones reales de HeyGen e HyperFrames responden correctamente y muestran confirmación tras corregir las notificaciones. OneDrive desconectado (ruta alternativa no probada).

## Pruebas técnicas completadas

`npm run verify` aprobado después de corregir el handler programado. Suites aprobadas: auth-bridge, model-json-response, syllabus-duration, curation, materials-generation, artifact-workspace, production-media-preview, publication, video-duration, coverage-gaps, hyperframes, remotion, composition-scenes, composition-presets y ai-usage. TypeScript aprobado después del bloqueo de revisión.

Smoke con proveedores reales (`scripts/test-pipeline-providers.mjs --live`): base válida, búsqueda y validación HTTP/contenido de fuentes, ejercicio generado. Este smoke no escribe cursos y no sustituye la prueba de las seis fases en UI.

Los logs de ejecución permanecen en `.tmp/qa-*.log` (ignorados por Git). No se incluyen credenciales en este informe.

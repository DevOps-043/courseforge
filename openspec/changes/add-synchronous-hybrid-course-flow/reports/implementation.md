# Evidencia de implementación local

Fecha: 2026-10-26. Estado: código y migración escritos; habilitación desactivada por defecto. No se desplegó ni se aplicó SQL remoto.

## Alcance entregado

- Ocho etapas conservadas, configuración de modalidad y agenda/planes/materiales por sesión.
- Capacidades de modelos y prompts editables por organización, herencia explícita y snapshot privado de ejecución.
- Jobs firmados, reserva por curso, progreso por unidad, reanudación, cancelación y rechazo de revisiones obsoletas.
- Curación adaptada a lecciones reales; fuentes de las sesiones sin plan Nexus ficticio.
- Aprobación híbrida coordinada mediante los servicios QA existentes; el procedimiento SQL nuevo no autoaprueba Nexus.
- Presentación web, guía y cuaderno HTML imprimibles, proyección por audiencia y manifiesto de revisión.
- Historial inmutable por revisión y marcas de actualización sin borrar trabajo editorial.
- Guardas de modalidad/vigencia antes de publicar Nexus y antes de depositar el payload en la outbox externa.
- Habilitación global y lista opcional de organizaciones; documentación operativa.

El usuario confirmó formatos web/imprimibles, acceso interno y generación coordinada de ambas ramas al pulsar el botón. No autorizó ni se ejecutaron pruebas de proveedores reales.

## Verificaciones ejecutadas

| Verificación | Resultado observado | Límite |
| --- | --- | --- |
| Suite nueva course-delivery | 22 pruebas correctas: política, vigencia, configuración, privacidad, fuentes por sesión y worker con fallo/reanudación simulados. | Sin proveedores reales ni sesión web autenticada. Se vuelve a ejecutar después de cambios relevantes. |
| PostgreSQL local PGlite 0.3.14 | 11 pruebas correctas: migración ejecutable, CAS, token, reserva única, cancelación, aprobación, historial, privilegios y ausencia de autoaprobación Nexus. | Esquema fixture mínimo y conexión local en memoria; no esquema desplegado ni contención real entre procesos. |
| test:curation | Correcto. | Proveedores y entorno controlados de la suite. |
| test:materials-generation | Correcto, incluidas 29 pruebas de generación y cinco de recuperación. | No generación real. |
| test:security-boundaries | Correcto. | No sustituye auditoría con roles/Auth Bridge reales. |
| test:syllabus-duration | Correcto. | Suite local existente. |
| test:remotion | Correcto. | No render ni QA audiovisual real. |
| TypeScript web completo | Correcto usando Node con 8 GiB de heap y tipos React DOM temporales. | El límite predeterminado de 2 GiB agotó memoria; el checkout tenía tipos React DOM ausentes. No se ocultaron errores con declaraciones any. |
| ESLint de archivos nuevos | Correcto desde apps/web con su configuración real. | No equivale a lint global de todo el repositorio. |
| Guard de migraciones | Correcto: 211 SQL. | Solo versiones y colisiones; no aplica SQL. |
| QA de exportaciones | Correcta en Edge headless: tres HTML, escritorio, ancho móvil e impresión A4; capturas inspeccionadas. | Fixtures sintéticos; no UI de ocho etapas autenticada ni diseño personalizado de marca. |
| OpenSpec del cambio | Válido con CLI 1.8.0 temporal. | La validación global falla por diagnose-font-catalog, cambio previo sin deltas. |
| verify:pr | Primer intento sin CLI local; segundo con CLI temporal se detiene en diagnose-font-catalog, cambio previo sin deltas. | No se presenta como verde; no se altera ni se omite la compuerta. |
| architecture:cycles | Encuentra 11 ciclos en archivos existentes de composition-editor; ninguno incluye course-delivery. | No se modificaron los archivos de esos ciclos; no se afirma que la arquitectura global esté libre de ciclos. |
| Lint global | Correcto con eslint . --quiet del workspace web. | Las advertencias históricas siguen siendo advertencias según la configuración existente, sin debilitar reglas. |
| docs:audit | Ejecutado; evidencia temporal regenerada. | El reporte inicial compara historial anterior; se contrastó el cambio actual con sus archivos primarios. |

Los comandos y dependencias temporales se describen en la [guía operativa](../../../../docs/operations/synchronous-hybrid-courses.md). El script de QA conserva fixtures en .tmp/course-delivery-qa. Las pruebas SQL no leen .env.

## Revisión adversarial del mismo agente

No se presenta como revisión independiente.

- Se comprobó que respuestas y preparación privadas no aparezcan en el paquete del participante.
- La SQL revoca lectura/mutación de tablas privadas y ejecución de RPCs a anon/authenticated; políticas restrictivas cubren las nuevas capacidades de settings.
- La revisión de Configuración detectó que las acciones anteriores solo comprobaban sesión para editar. Se restringió su edición a roles revisores de la organización o administradores globales verificados, se acotaron consultas por organización y actualizaciones globales por scope/tipo, y las capacidades sincrónicas se administran solo desde su frontera autorizada.
- La reserva única y los tokens impiden replay local; aprobar o guardar exige revisiones actuales y contexto consistente.
- Los snapshots permiten reintentos con el mismo prompt/modelo y conservan versiones anteriores.
- Los cambios de configuración y agenda marcan contenido para actualizar sin vaciarlo; unidades válidas se reutilizan.
- La aprobación conjunta no reemplaza los validadores QA existentes de Nexus. Una confirmación parcial no declara completa la modalidad híbrida.
- Se detectaron y corrigieron tipos faltantes del entorno, tipado de opciones de proveedor, exposición técnica del manifiesto en el pie de documentos y parámetros de entrada para generación.
- Nexus conserva una lectura ligera; el polling evita solapamientos mediante el hook compartido, impone timeout y no vuelve a resolver todos los prompts en cada consulta de progreso.

## Rechazos de revisión automática y resolución

1. Se rechazó escribir aprobación de materiales Nexus desde una migración/procedimiento nuevo. Se descartó: se reutilizan las acciones QA existentes y su autorización.
2. Se rechazó vaciar planes/materiales al cambiar configuración o regenerar agenda. Se descartó: se conservan borradores, historial y marcas de actualización.
3. Se pidió autorización explícita para coordinar generación Nexus potencialmente sujeta a consumo de API. El usuario la concedió después de aclarar que se trata de cuota/créditos de los proveedores ya configurados. La coordinación solo ocurre mediante acción del usuario; no se probaron proveedores reales.

No hay un rechazo pendiente que se esté eludiendo mediante otro mecanismo.

## Pendientes antes de habilitar en un entorno compartido

- Revisar y aplicar migración sobre el esquema completo mediante el proceso autorizado.
- Piloto con sesiones Auth Bridge y roles reales, tres modalidades y fuentes representativas.
- Revisar calidad pedagógica del contenido generado y consumo real; no se promete exactitud semántica ni reducción porcentual de costo.
- Ensayar recuperación/rollback con procesos concurrentes reales, límites de proveedor y despliegue Netlify.
- Definir retención y limpieza autorizada de historial/runs; no se implementa eliminación automática.
- Resolver la compuerta global OpenSpec y el aprovisionamiento de dependencias de desarrollo del entorno.
- Integrar en la rama objetivo antes de archivar OpenSpec. El cambio permanece abierto.

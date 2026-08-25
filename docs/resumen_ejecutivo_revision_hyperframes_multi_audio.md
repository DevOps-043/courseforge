# Resumen ejecutivo — Revisión de HyperFrames con múltiples audios de voz

**Fecha:** 24 de agosto de 2026  
**Alcance:** generación separada de avatar y voz, múltiples clips de voz, timeline nativo, snapshot, ZIP y envío a HyperFrames Cloud.  
**Fuente de verdad metodológica:** `docs/prompt_maestro.md`.  
**Decisión de alcance:** Remotion queda expresamente fuera de esta revisión y no se propone modificarlo, migrarlo ni eliminarlo como parte de este trabajo.

## 1. Entendimiento del objetivo

La fase revisada debe permitir que cada escena producida con HeyGen genere dos assets independientes y sincronizados: un clip visual de avatar y un clip de voz. La voz es la referencia temporal principal. Cuando existan varios guiones o escenas, la duración narrativa final debe obtenerse de la suma ordenada de todos los clips de voz válidos.

El ensamblador nativo debe poder abrirse con los primeros assets disponibles, conservar las ediciones del usuario e incorporar los assets restantes conforme terminen. Antes de enviar un render, el sistema debe demostrar que la colección de voces está completa, ordenada, vigente y sin solapamientos. El paquete final debe continuar usando exclusivamente el flujo vigente de HyperFrames: documento nativo, snapshot inmutable, ZIP interno y API de HyperFrames Cloud.

Esta capacidad pertenece a la primera fase de producción y debe poder quedar estable sin depender de una futura automatización masiva de materiales o videos en background.

## 2. Diagnóstico técnico

### Conclusión ejecutiva

**Estado actual: funcional de forma parcial, pero todavía no seguro para producción incremental con múltiples audios.**

La separación de pistas ya está correctamente encaminada en HeyGen: cada escena conserva `clip_id`, `order`, `script_hash`, duración y estado; además, un trabajo configurado con `separate_tracks: true` falla de forma cerrada si no obtiene una voz independiente. El MP4 promovido junto con una voz importada queda marcado como `has_audio: false`, evitando duplicar la narración en el camino esperado.

HyperFrames también reconoce la voz como fuente prioritaria de duración y suma todos los assets con rol `VOICE`. Los clips de un mismo track se construyen de forma secuencial y el compilador genera elementos `<audio>` separados de los videos. Estas decisiones son coherentes con el contrato nativo de HyperFrames.

El riesgo aparece entre la persistencia de Producción y el timeline: al sincronizar los assets se pierden los identificadores semánticos de escena, y la consulta posterior devuelve los registros por `created_at DESC`. Por ello, una colección correcta en `voice_clips[]` puede llegar al editor en un orden distinto al de los guiones. Adicionalmente, el editor actualmente sólo sincroniza los assets al abrirse; no observa la finalización de nuevos clips. Si se fuerza una reconciliación posterior, los assets faltantes se construyen desde el segundo cero de su subconjunto, con posibilidad de solaparse con voces ya existentes.

El ZIP y la integración Cloud tienen controles sólidos de integridad física, trazabilidad, tamaño, checksum, idempotencia y pertenencia organizacional. Sin embargo, el snapshot no valida todavía la integridad narrativa de la colección. En consecuencia, un paquete técnicamente válido podría contener voces parciales, reordenadas o desalineadas.

### Flujo activo revisado

```text
Guiones por escena
      ↓
HeyGen: voz independiente + avatar por escena
      ↓
material_components.assets: voice_clips[] + avatar_clips[]
      ↓
production_assets: registro de media para HyperFrames
      ↓
video_composition_draft_assets + documento/timeline nativo
      ↓
snapshot inmutable + manifest + ZIP
      ↓
direct upload + POST /v3/hyperframes/renders
```

### Hallazgos principales

| Prioridad | Hallazgo | Impacto |
| --- | --- | --- |
| Crítica | El registro HyperFrames no propaga `clip_id`, `order` ni `script_hash`; posteriormente lista por fecha descendente. | La voz puede quedar en un orden diferente al guion y producir una duración acumulada numéricamente correcta, pero semánticamente incorrecta. |
| Crítica | El snapshot no exige que estén todas las voces esperadas, que sus hashes estén vigentes ni que cada avatar tenga su voz correspondiente. | Se puede pagar y enviar un render parcial aunque aún existan escenas en generación. |
| Alta | El editor abierto no refresca ni se suscribe a la llegada de nuevos assets de Producción. | No se cumple todavía la edición concurrente mientras continúan las generaciones en background. |
| Alta | La reconciliación de assets faltantes secuencia sólo el subconjunto nuevo desde `0`, sin usar el final del track existente. | Una segunda voz puede superponerse a la primera y alterar la mezcla o la duración efectiva. |
| Alta | No existe una regla final que compruebe que la duración del render sea exactamente la suma ordenada de voces activas. | Ediciones visuales o reconciliaciones parciales pueden dejar cola silenciosa o cortar narración. |
| Media | La tabla de vínculo del draft sólo conserva `role` y `source_reference`; la semántica de escena depende de metadatos no tipados. | Resulta más difícil auditar, ordenar y reparar una composición de forma determinista. |
| Media | Las pruebas cubren prioridad de una voz y secuenciación de múltiples avatares, pero no una colección real de múltiples voces ni su llegada incremental. | La suite verde no protege todavía las regresiones que motivan esta revisión. |

### Controles que ya están correctos

- HeyGen crea y reconcilia `voice_clips[]` por `clip_id`, actualiza el orden desde el avatar activo y marca como `STALE` una voz cuyo `script_hash` ya no coincide.
- La generación por escenas usa `separate_tracks: true` y detiene la promoción si falta el audio independiente.
- La duración base del documento prioriza la suma de todos los assets `VOICE` por encima de avatar, B-roll o slides.
- El track `VOICE` es un track de audio independiente y actúa como disparador principal del ducking de música.
- El compilador HyperFrames mantiene el video y el audio como elementos separados y sólo reproduce audio embebido cuando `hasAudio` lo declara explícitamente.
- Las rutas de sincronización, draft, snapshot y render verifican autenticación, organización activa, permisos e identificadores.
- El snapshot usa únicamente assets internos vinculados, genera manifest, checksum y ZIP inmutable.
- La entrega Cloud valida tamaño, checksum e idempotencia; no acepta HTML o ZIP arbitrario enviado por el navegador.

## 3. Plan de implementación

### Fase A — Contrato semántico y timeline determinista

Esta fase puede desplegarse y validarse de forma independiente. Su objetivo es que una sincronización manual o inicial siempre produzca el mismo timeline correcto.

1. Extender el contrato tipado de asset desde `voice_clips[]` y `avatar_clips[]` hasta el draft con `sceneId`/`clipId`, `sceneOrder`, `scriptHash` y `pairRole`.
2. Persistir esos campos en `production_assets.metadata` y reflejarlos de forma explícita en el descriptor consumido por el editor. Para consultas frecuentes y garantías de unicidad, evaluar columnas e índices dedicados en lugar de depender sólo de JSONB.
3. Ordenar voces y avatares por `sceneOrder` ascendente antes de construir o reconciliar el documento; usar ID como desempate estable. `created_at` debe conservarse sólo como información de auditoría.
4. Reconciliar un asset nuevo desde el final real de su track y no desde cero. La operación debe ser idempotente, no mover clips editados por el usuario y rechazar solapamientos en `VOICE`.
5. Recalcular `narrationDuration` como suma de las duraciones de voz activas, medidas con precisión de milisegundos. La política de esta fase debe fijar `canvas.durationSeconds` al final de la narración, salvo que en el futuro exista una opción explícita y validada para una cola silenciosa.
6. Mantener los avatares mudos cuando exista voz independiente. Si un avatar emparejado declara audio embebido, bloquear el snapshot en lugar de mezclar ambas narraciones.

**Criterio de salida de Fase A:** dada la misma colección de escenas, cualquier sincronización produce el mismo orden, los mismos offsets, una sola narración audible y una duración final igual a la suma de voces.

### Fase B — Incorporación incremental y puerta semántica de render

Esta fase agrega la experiencia de background sin cambiar el contrato de HyperFrames Cloud.

7. Exponer un estado de generación por escena que incluya conteo esperado, completado, fallido y obsoleto. El editor puede abrirse de forma parcial, pero debe mostrar claramente qué escenas faltan.
8. Añadir actualización automática de assets mediante Supabase Realtime o polling acotado con respaldo. Al recibir un cambio, ejecutar en servidor la sincronización idempotente y después reconciliar el documento mediante control de versión/ETag.
9. Proteger las ediciones: añadir sólo assets nuevos, conservar clips con cambios manuales y presentar conflicto cuando una regeneración sustituya una voz que el usuario ya recortó o dividió.
10. Crear un `assemblyReadiness` semántico separado de la disponibilidad para editar. Antes del snapshot debe exigir: órdenes únicos y contiguos, todas las escenas activas completas, hashes vigentes, duración positiva, pareja voz/avatar válida, avatar mudo, cero solapamientos de voz y final del canvas igual al final narrativo.
11. Guardar en el manifest del snapshot la colección canónica de escenas y su hash agregado. La revisión de envío debe verificar que ese contrato coincide con los assets vinculados antes de subir el ZIP.
12. Mantener sin cambios el transporte Cloud salvo por consumir el nuevo resultado de preflight. El upload directo, checksum, límite de tamaño, idempotency key y polling durable actuales deben conservarse.

**Criterio de salida de Fase B:** un usuario puede editar mientras se generan escenas restantes, observar su incorporación sin recargar y sólo enviar a render cuando la colección narrativa completa supera el preflight semántico.

## 4. Implementación propuesta

No se modificó código funcional durante esta revisión. La propuesta afecta únicamente el flujo vigente de HyperFrames y los contratos que lo alimentan:

- `apps/web/src/domains/production/providers/heygen/heygen-scenes.service.ts`: fuente canónica de identidad, orden, hash y emparejamiento de cada escena.
- `apps/web/src/domains/production/hyperframes/hyperframes-source-asset.service.ts`: propagación de metadatos semánticos y orden determinista al listar assets.
- `apps/web/src/domains/production/hyperframes/hyperframes-draft.service.ts`: vínculo de assets y reconciliación idempotente del draft.
- `apps/web/src/domains/production/composition-editor/composition-document.factory.ts`: inserción incremental desde el final del track, preservación de ediciones y recálculo de duración.
- `apps/web/src/domains/production/composition-editor/composition-duration.service.ts`: contrato explícito de `narrationDuration` basado en la suma de voces.
- `apps/web/src/domains/production/composition-editor/composition-snapshot.service.ts`: preflight semántico previo a crear un ZIP pagable.
- `apps/web/src/domains/materials/components/HyperframesCompositionPanel.tsx`: estado parcial, actualización automática y aviso de conflictos.
- Migración aditiva de Supabase, si se eligen columnas tipadas o restricciones para escena/orden. Debe mantener RLS y aislamiento por `organization_id`.

La implementación debe conservar la separación entre dos estados:

- **Editable:** existe al menos un asset utilizable y el usuario puede avanzar.
- **Renderable:** todas las escenas y voces esperadas satisfacen el contrato semántico completo.

## 5. Riesgos y validaciones

### Riesgos operativos

- **Condición de carrera:** una voz puede terminar mientras el usuario guarda una edición. Mitigación: reconciliación en servidor con hash/ETag, relectura y reintento limitado.
- **Regeneración de guion:** un `script_hash` nuevo invalida la voz anterior. Mitigación: nunca sustituir silenciosamente una voz ya editada; marcar conflicto y solicitar decisión.
- **Precisión temporal:** redondear a segundos enteros puede acumular error entre escenas. Mitigación: usar `duration_milliseconds` y normalizar al FPS sólo al materializar clips.
- **Audio doble:** un MP4 con audio y su voz independiente pueden sonar simultáneamente. Mitigación: `hasAudio: false` obligatorio para el avatar emparejado y validación final.
- **Render parcial:** el editor parcial es intencional, pero no debe implicar readiness. Mitigación: puertas separadas para edición y snapshot.
- **Costo externo:** un fallo semántico descubierto después del POST a Cloud ya consume tiempo y potencialmente costo. Mitigación: validar antes de crear y subir el ZIP.

### Matriz mínima de pruebas requerida

1. Tres voces completadas fuera de orden se ensamblan por `sceneOrder` y suman exactamente su duración.
2. La segunda y tercera voz llegan después de abrir el editor y se anexan sin solapamiento ni pérdida de ediciones visuales.
3. Una escena faltante permite editar, pero bloquea snapshot y render con un mensaje accionable.
4. Una voz `STALE`, un orden duplicado o una duración ausente bloquean el snapshot.
5. Una regeneración concurrente detecta conflicto si el clip anterior fue recortado o dividido.
6. Cada avatar con voz separada se compila mudo; sólo los elementos `<audio>` de voz producen narración.
7. El final del canvas coincide con la suma ordenada de voces y no deja cola silenciosa.
8. El manifest del snapshot y los vínculos de base de datos contienen exactamente la misma colección canónica.
9. El ZIP conserva checksum, límite de tamaño e idempotencia y continúa siendo aceptado por el cliente Cloud.
10. Dos organizaciones no pueden leer, vincular ni renderizar assets entre sí.

### Validación ejecutada durante la revisión

Se ejecutó `npm run test:hyperframes --workspace=apps/web`: **196 pruebas aprobadas, 0 fallidas**. La suite confirma la salud general del flujo HyperFrames, incluyendo preflight, cliente Cloud, drafts, snapshots, compilación y edición. No obstante, no contiene todavía casos específicos para múltiples voces ordenadas, llegada incremental o bloqueo de snapshot parcial; por ello, el resultado verde no elimina los riesgos críticos descritos.

No se ejecutó un render real ni se invocó HeyGen/HyperFrames Cloud, para evitar cambios externos y consumo de proveedor durante una revisión estática.

## 6. Mejoras adicionales recomendadas

- Añadir telemetría sin datos sensibles para `expectedScenes`, `completedVoices`, `staleVoices`, `narrationDurationMs` y motivo de bloqueo de snapshot.
- Mostrar en la UI una lista por escena con estado de voz/avatar y un progreso del tipo “2 de 5 escenas listas”.
- Registrar un hash canónico de la colección narrativa para detectar cambios entre apertura del editor, snapshot y render.
- Incorporar una acción explícita de “reconciliar ahora” como respaldo manual, incluso cuando Realtime o polling estén activos.
- Documentar la política temporal: la voz manda, los visuales se adaptan a ella y cualquier cola silenciosa futura requiere una decisión explícita del usuario.
- Revisar por separado las rutas HyperFrames heredadas que ya no usa el editor nativo y marcar su deprecación para evitar dos caminos de render con contratos distintos. Esta limpieza no debe mezclarse con la implementación de múltiples audios.

## Dictamen

La generación separada de voz y avatar ya tiene una base correcta y el transporte a HyperFrames Cloud es robusto. Antes de considerar terminada la fase de múltiples audios, deben resolverse tres condiciones: **preservar el orden semántico de escena, reconciliar assets incrementales sin solapamiento y bloquear el snapshot hasta comprobar la colección narrativa completa**. Estas correcciones pueden implementarse dentro del flujo HyperFrames actual sin depender de Remotion ni modificar la API Cloud existente.

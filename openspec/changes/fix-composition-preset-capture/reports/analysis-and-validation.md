# Análisis y validación — 2026-11-06

## Alcance y evidencia del incidente

Se siguieron panel, controlador, ruta de creación, extracción, almacenamiento,
preview, aplicación y undo. Los modos MANUAL e INSTRUCTIONS convergen en la
misma extracción; la segunda aplica primero patches validados a una copia.
No se dispone del ID o snapshot del preset reportado: se corrigieron defectos
reproducibles en el código, sin atribuirle una causa exclusiva al caso real.

No se encontró sustitución de referencias de medios en el aplicador: trabaja
sobre una copia del documento destino y modifica propiedades de sus clips.
Una diferencia visible de posición, recorte, capa o ajuste visual puede parecer
un cambio de asset. Las pruebas comparan referencias y contenido para distinguirlo.

## Hallazgos confirmados y corrección

| Hallazgo anterior | Consecuencia | Corrección |
| --- | --- | --- |
| Crear no utilizaba el paso de flush/cola/recuperación del editor | Captura de la última versión persistida, omitiendo campos locales pendientes | `runNativeBypass` confirma pendientes y recuperación antes de leer el hash y crear, en ambos modos |
| El controlador atrapaba errores y devolvía éxito implícito al formulario | El formulario podía vaciarse pese a un fallo | Resultado booleano, error explícito, bloqueo de duplicados y formulario conservado |
| Diagnósticos persistidos pero ignorados por la UI | Pérdidas parciales invisibles | Confirmación y diagnósticos visibles y deduplicados tras crear |
| Variantes limitadas a las primeras 24 | Se perdían las configuraciones posteriores | Se capturan hasta los 500 clips admitidos por el documento, sin truncamiento |
| `durationWeight <= 100` | No se guardaban clips válidos de 2–3 minutos | Límite compartido con el documento: 600 segundos |
| Capas limitadas a 100 en presets | Fallos con capas ampliadas válidas | Rango hasta 1000 y registro de capas requeridas al aplicar |
| Un único slot por rol, aunque existieran varias pistas y tipos | Configuración cruzada entre elementos y volumen heredado de la primera pista | Slots por rol, ordinal de pista y tipo; no se reemplazan pistas del destino |
| Timing irregular se convertía en PRESERVE | No se restauraba la distribución editada | PATTERN con ventanas relativas; cardinalidad distinta conserva timing destino y avisa |
| Adyacencia toleraba hasta 80 ms | Se borraban pequeños huecos o solapamientos al inferir secuencias | Tolerancia de un microsegundo, coherente con el límite temporal del documento |
| Solo motion basado en presets | Se omitían keyframes manuales y anclas modificadas | Motion estructurado sin IDs, desplazamientos relativos al canvas, ancla y easing conservados |
| Faltaban color, fades, mezcla y estilos nuevos | El preset guardado no representaba la edición | Captura V2 y neutralización explícita de valores que estaban ausentes |
| Modos por instrucciones no revalidaban tras la propuesta | Podían guardar un patrón basado en una versión anterior | Segunda lectura y conflicto 409 si cambió el documento durante la propuesta |

La regresión general descubrió además que DECK_SLIDE producía un ID de slot
con guion bajo, inválido para el contrato editorial. Se normalizó a guiones.
También se evita colisionar IDs de animaciones con las que conserva el destino.

## Cobertura de parámetros actuales

| Área | V2 captura y aplica | Conservado del destino / límite |
| --- | --- | --- |
| Identidad y medios | Selección por rol, pista ordinal y tipo | IDs, hfId, fuente, checksum indirecto, archivo, dimensiones originales y etiquetas |
| Geometría | Posición/tamaño relativos, rotación, opacidad, capas hasta 1000, crop, máscara, fit efectivo | Dimensiones/FPS/orientación del canvas; límites del documento siguen validándose |
| Audio | Ganancia de clip/pista/maestro, mute/hidden de pista, fades relativos y ducking completo | Envolvente anclada a fuente, recorte, duración disponible, vínculo de escena |
| Motion | Keyframes validados, easing, propiedad, ancla, ventana relativa, metadata de preset y ciclos finitos | Identificadores nuevos. Ciclo escalado limitado al rango válido 0.5–8 s |
| Color | Exposición, contraste y saturación | Neutro elimina el ajuste previo; no introduce LUTs o recursos externos |
| Texto/captions | Layout, estilo general y efectos generales de captions | Palabras, cues, timestamps, énfasis/efectos por frase y referencias privadas de fuentes |
| Timing | Secuencia, stack y ventanas irregulares proporcionales | Audio limitado por fuente; captions, velocidad/congelación y transiciones mantienen timing propio |
| Estructura | No transporta una copia del curso | Agrupaciones, transiciones, escenas narrativas, HTML/CSS, variables y exclusiones del destino |

Las propiedades portables sin valor explícito se capturan con su valor efectivo
cuando corresponde: volumen, visibilidad, fit y mezcla. De esta forma no heredan
accidentalmente un ajuste anterior del destino. Los presets V1 conservan el
comportamiento previo y los presets del sistema siguen V1.

`composition-preset-field-policy.ts` declara una política para cada campo de
`CompositionClip` y `CompositionEditorDocument` mediante `satisfies Record<...>`.
Una ampliación de esos tipos requiere una decisión de cobertura; la prueba de
claves también contrasta la política con los schemas reales. No sustituye
revisar restricciones y consumidores de un parámetro nuevo.

## Validaciones

- `npm run test:composition-presets --workspace=apps/web`: 20 pruebas específicas
  aprobadas. Incluyen manual/agente, contenido propio, defaults, duración,
  capas, 30 variantes, selección por pistas/tipos, motion, estilos nativos,
  timing irregular, compatibilidad V1 y políticas exhaustivas.
- `npm run test:hyperframes --workspace=apps/web`: ejecución final con código 0;
  695 pruebas aprobadas, 0 fallos. Ahora incluye la suite de presets, que antes
  solo estaba en su comando específico.
- `npm run typecheck`: ejecución corregida con código 0. Las primeras ejecuciones
  detectaron errores de fixtures y firma de screenshot, corregidos antes de
  completar las suites.
- `npm run qa:composition-preset-capture --workspace=apps/web`: ejecución final
  con código 0 en Chromium temporal fuera del sandbox. El primer runner quedó
  bloqueado dentro del sandbox y se cerró identificando su PID y comando exactos.
  La prueba confirma error sin limpiar formulario, éxito con diagnósticos y
  envío del hash en manual/instrucciones. HTTP es simulado: no invoca IA pagada.
- `npm run verify:pr`: ejecución completa con código 0. Lint sin errores ni
  nuevos warnings (baseline 570), tipos, grafo de 2384 módulos sin ciclos,
  guard de 219 migraciones y suites del arnés, branding, seguridad, audio,
  cobertura de producto e impartición aprobados. Se redirigieron
  TEMP/TMP a `.tmp/preset-capture-temp` para que los fixtures Git del arnés puedan
  escribir dentro del workspace; no se cambiaron los verificadores ni sus reglas.
- `npm run docs:check`: código 0, 354 documentos comprobados.
  `npm run openspec:validate`: código 0, 51 elementos válidos y 0 fallos.
- Lint detectó inicialmente una variable de destructuring sin usar. Se sustituyó
  por copia y eliminación explícita de la referencia privada; sin ampliar baseline.

Salidas completas locales: `.tmp/preset-capture-tests-final.log`,
`.tmp/preset-capture-hyperframes-final.log`, `.tmp/preset-capture-typecheck-final.log`,
`.tmp/preset-capture-qa-final.log` y `.tmp/preset-capture-verify-pr.log`.
Artefactos de QA: `apps/web/.tmp/composition-preset-capture-qa/report.json` y
`preset-guardado.png`. Se inspeccionó el screenshot: es una fixture funcional
sin el pipeline completo de Tailwind; no acredita el acabado visual de producción.

## Revisión adversarial propia

- Se preservaron autorización por usuario/rol/organización y If-Match; la
  creación por instrucciones revalida el hash después de esperar al agente.
- El agente produce patches validados; no escribe JavaScript ni definiciones
  arbitrarias. Ambos modos usan el mismo servicio de captura.
- El preview/aplicación sigue siendo no destructivo, versionado y deshacible.
  Los tracks bloqueados se omiten y se conserva la protección de fuentes.
- Todos los cambios se producen en una copia y se valida el documento final;
  no se persiste un resultado parcialmente aplicado.
- La creación no guarda automáticamente la propuesta del agente en el curso.
  Los errores dejan al usuario sus datos para reintentar.
- No se añadieron dependencias, migraciones, accesos a secretos ni operaciones
  externas reales. Se preservaron los cambios anteriores de optimización de carga.
- Revisión del mismo agente, sin afirmar independencia.

## Límites y reproducción en QA

No se ejercitó una sesión autenticada del editor completo, el preset concreto
reportado, la persistencia Supabase real ni el proveedor IA real. No se hizo
build ni render cloud. La latencia y el aspecto final requieren QA de producto.

En QA autenticada: modificar un valor y crear de inmediato desde ambos modos;
comprobar que el preview reproduce el valor confirmado. Aplicar a otra lección,
comparar las referencias de sus medios y texto, confirmar, recargar y deshacer.
Incluir cambios simultáneos desde otra pestaña, tracks bloqueados, captions y
presets antiguos. Un fallo debe conservar nombre/descripción/instrucción.

La información omitida por presets V1 existentes no puede recuperarse sin su
documento original: deben recapturarse desde la edición correcta. Los lectores
antiguos rechazan V2, por lo que un rollback tras crear V2 debe conservar el
lector compatible. No se desplegó ni se modificaron presets históricos.

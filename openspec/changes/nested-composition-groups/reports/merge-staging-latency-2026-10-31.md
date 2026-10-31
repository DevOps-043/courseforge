# Resolución del merge con edición local inmediata

Fecha: 2026-10-31. Merge iniciado por el usuario sobre `staging`.

## Ramas y alcance

- HEAD: `2eb268fb`, que ya contiene branding `968fe2fe`, bucle `e7b5213a` y
  edición local inmediata `9dd74158`.
- MERGE_HEAD: `064ecb32`, agrupaciones anidadas.
- Un único archivo en conflicto: `NativeCompositionPreview.tsx`, en el montaje
  del inspector, panel de selección y controles de transición.

Se preservó el estado anterior en `.tmp/merge-latency-groups-20261031/`, sin
crear worktrees ni sustituir el resto de los archivos ya preparados por Git.

## Decisiones e impacto

| Elemento | Resolución | Motivo y riesgo evitado |
| --- | --- | --- |
| Inspector | Conservar `saving` y `editingDisabled={localEditingBlocked}` de staging | Mantiene edición local inmediata y los bloqueos durante recuperación, errores u operaciones incompatibles |
| Panel de selección | Conservar `canCreateNestedGroups={payload.capabilities?.canCreateNestedGroups ?? false}` de agrupaciones | La UI no ofrece crear anidamientos cuando el servidor no confirma disponibilidad |
| Limpiar selección | Usar `clearTimelineSelection` de agrupaciones | Deseleccionar elementos no saca al usuario del nivel de agrupación que está editando |
| Bloqueo de selección y transiciones | Conservar `saving={localEditingBlocked}` de staging | Evita volver al bloqueo indiscriminado por cada guardado y conserva protección ante estados de recuperación |
| Servicios y contratos | Conservar los cambios automáticos de agrupaciones y la proyección local existente | Las operaciones locales se calculan con la misma jerarquía que las confirmadas |

Aceptar todo el lado de staging perdería la capacidad del panel y el contexto
de navegación anidada. Aceptar todo el lado entrante retiraría los bloqueos
específicos de la mejora de latencia. La resolución combina ambos contratos.

No se modificaron autenticación, autorización tenant, límite de profundidad,
migraciones, proveedor de render ni el formato canónico de motion. La capacidad
del cliente no concede autoridad y los guards de servidor siguen siendo
obligatorios.

## Regresión añadida

`composition-local-edits.test.ts` ahora cubre la creación local de un contenedor
con dos grupos, su movimiento antes del ACK, la extensión del canvas y la
confirmación del primer comando sin perder el segundo. Cancelar el movimiento
recupera el estado confirmado conservando la jerarquía.

## Verificaciones

| Verificación | Resultado |
| --- | --- |
| Compilación de la suite HyperFrames | Salida 0 |
| Cuatro archivos de pruebas: edición local, autoguardado, grupos y selección | 46 aprobadas, 0 fallos; incluye la regresión nueva |
| ESLint dirigido al host y la regresión | Salida 0 |
| OpenSpec de agrupaciones, validación estricta | Aprobado |
| Enlaces documentales | 169 documentos verificados |
| QA Chromium de grupos | Selección aditiva, capacidad, dos niveles, navegación, Escape y desagrupación aprobados |
| Tipos de la aplicación completa | Salida 0 con heap de 4 GiB |

El primer intento de compilación detectó un campo incorrecto en la prueba nueva;
se corrigió para usar `startSeconds`, que es el contrato de `group.move`, y se
repitió la compilación completa con salida 0. No se cambió la API. La revisión
fue realizada por el mismo agente; no se afirma independencia ni una sesión
autenticada contra Storage, render cloud, build o CI.

## Funcionalidades que este merge no incorpora

La descarga de clips recortados todavía no está en HEAD ni en MERGE_HEAD. Sigue
conservada y publicada en `codex/fix-clip-range-export` (`d8cafb0a`). Su ausencia
en este merge no representa pérdida: el usuario está integrando ramas originales
por separado. Para incorporarla después conviene comparar e integrar esa rama,
preservando las mejoras de edición local inmediata y agrupaciones ya reunidas.

La activación de agrupaciones mantiene sus dos migraciones y
`COMPOSITION_NESTED_GROUPS_ENABLED`, con confirmación del RPC de capacidad.
No se aplicó SQL remoto. La resolución se deja preparada para que el usuario
revise y confirme el merge; no se publica `staging` desde esta tarea.

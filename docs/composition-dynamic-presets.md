# Presets dinámicos del editor de composición

## Alcance implementado

El editor nativo de HyperFrames permite crear presets reutilizables desde una
edición guardada o desde una transformación restringida propuesta por SofLIA.
La IA participa en la interpretación de la intención; la extracción,
adaptación, validación, aplicación y reversión son deterministas.

La implementación no guarda ids de assets, URLs, HTML, labels ni texto del
curso dentro de un preset. Un preset contiene únicamente:

- selectores por `semanticRole` y tipo de clip;
- variantes normalizadas de layout, crop, fit y volumen;
- reglas temporales `PRESERVE`, `SEQUENCE` o `STACK`;
- animaciones parametrizables basadas en el catálogo existente;
- ajustes de track y ducking.

## Flujo seguro

1. El servidor resuelve el preset dentro de la organización activa.
2. El motor lo aplica en memoria sobre la versión guardada actual.
3. El resultado completo se valida con `compositionEditorDocumentSchema`.
4. Se persiste un preview con el documento base y el propuesto, sin modificar
   el draft.
5. El monitor compila ese preview con los mismos assets y compilador del editor.
6. La confirmación exige el hash fuerte actual mediante `If-Match`.
7. La función SQL bloquea el draft, vuelve a validar el hash y agrega una nueva
   versión append-only junto con su evento de auditoría.
8. Deshacer agrega otra versión con el documento base exacto. Si hubo una
   edición posterior, falla con conflicto para no sobrescribirla; el usuario
   puede restaurar expresamente cualquier versión desde el historial existente.

Los render snapshots permanecen inmutables y los assets de origen nunca se
eliminan ni se sustituyen al aplicar un preset.

## Restauración desde snapshots

Cada snapshot conserva el hash y la versión exacta del documento editable que
originó el ZIP de render. Al restaurarlo, una única transacción:

- verifica que el timeline no haya cambiado en otra sesión;
- agrega el documento histórico como una nueva versión append-only;
- restaura los enlaces históricos de intro y outro;
- activa la revisión de salida y revoca una aprobación anterior;
- devuelve el documento restaurado para actualizar inmediatamente el timeline
  y el preview del editor.

El historial diferencia `salida activa` de `en timeline`. Esto permite reparar
estados anteriores en los que una revisión estaba activa para render, pero el
editor todavía mostraba una versión distinta. Los assets de branding archivados
siguen disponibles para reproducir snapshots históricos, aunque no se ofrecen
para selecciones nuevas.

## Adaptación a cantidades variables

`SEQUENCE` repite el patrón de variantes extraído y redistribuye el rango en
frames completos, conservando los pesos relativos de duración. Así, un patrón
manual de cinco elementos puede aplicarse a quince sin crear huecos, solapes ni
duraciones sub-frame. `STACK` conserva una ventana común para overlays y
`PRESERVE` respeta el timing actual cuando éste contiene sincronización
narrativa que no debe inferirse.

Los tracks bloqueados se conservan y generan una advertencia en el preview. Los
slots obligatorios sin assets y los documentos que excedan límites de clips,
animaciones, tiempo o canvas fallan antes de persistir.

## Persistencia y despliegue

Aplicar antes de habilitar la UI:

`supabase/migrations/20260829120000_create_video_composition_presets.sql`

`supabase/migrations/20260829130000_restore_composition_snapshot_to_editor.sql`

La migración crea:

- `video_composition_presets`;
- `video_composition_preset_versions`;
- `video_composition_preset_applications`;
- RPCs transaccionales de creación, aplicación y reversión;
- RPC transaccional para restaurar snapshot, timeline y branding en conjunto;
- RLS e índices por organización, estado, draft y expiración.

Los tres presets iniciales viven en código y no se duplican por tenant:
`Presentador + diapositivas`, `Presentador protagonista` e `Historia visual`.

## Verificación

- `npm run test:composition-presets --workspace=apps/web`
- `npm run test:hyperframes --workspace=apps/web`
- `npx tsc -p apps/web/tsconfig.json --noEmit`
- `npm run build`

Prueba manual recomendada: crear un preset desde cinco B-rolls o diapositivas,
aplicarlo a otra edición con una cantidad distinta, revisar el preview, aplicar,
hacer una edición manual posterior y comprobar que el undo automático se niega
a sobrescribirla mientras el historial conserva ambas versiones.

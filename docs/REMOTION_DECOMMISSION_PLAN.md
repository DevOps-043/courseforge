# Retiro seguro de Remotion

Fecha: 2026-08-17  
Estado: inventario confirmado; la purga de datos requiere respaldo verificable.

## Objetivo

Eliminar el motor Remotion, sus bundles, previews, endpoints, workers y dependencias sin afectar el editor y pipeline de producción basados en HyperFrames.

La fuente funcional que debe permanecer es:

```text
PostproductionAssemblyContainer
  -> HyperframesCompositionPanel
  -> /api/production/hyperframes/*
  -> composiciones, snapshots, revisiones y renders HyperFrames
```

`PostproductionAssemblyContainer` ya usa `HyperframesCompositionPanel`; no depende del preview ni del render de Remotion.

## Límite de seguridad

No se debe ejecutar una migración `DROP` contra producción hasta que un respaldo exportable de las tablas y del storage se haya validado y su ubicación se haya registrado. Los datos históricos no son necesarios para el runtime HyperFrames, pero una eliminación irreversible sin ese respaldo viola la trazabilidad de renders ya publicados.

La retirada de código puede y debe ocurrir antes. Una vez desplegada, los datos Remotion quedan inaccesibles por la aplicación y listos para su purga controlada.

## Inventario confirmado

| Superficie | Ubicación | Tratamiento |
| --- | --- | --- |
| Composiciones y Player | `apps/web/src/remotion/**`, `RemotionPreviewPlayer*`, timeline y layout overrides | Eliminar; no son usados por el estudio HyperFrames. |
| API Express legacy | `apps/api/src/features/production/**`, `/api/v1/production/remotion/*` | Eliminar junto con el arranque/prewarm y dependencias Remotion. |
| Control plane / worker de escritorio | `apps/web/src/lib/server/desktop-worker-*`, `/api/v1/production/remotion/workers/*`, telemetría | Eliminar. HyperFrames usa sus rutas Next y render cloud; no usa este worker. |
| Templates y bundles ZIP | `custom-bundles/**`, `domains/production/bundle-agent/**`, `templates.actions.ts`, páginas y rutas `/admin/remotion/**` | Eliminar. El generador de ZIP no es portable a HyperFrames. |
| Dependencias | `@remotion/*`, `remotion` en `apps/web` y `apps/api`; Docker/cloud env | Eliminar después de retirar imports. |
| Datos y storage | tablas `remotion_templates`, `remotion_template_versions`, `remotion_template_builds`, previews; objetos `remotion-bundles/**` y bundles de template | Archivar, verificar y después purgar mediante migración separada. |

## Orden obligatorio de ejecución

1. Proteger rutas públicas: redirigir los enlaces de edición/ensamblado activos al estudio HyperFrames y retirar navegación de templates/worker.
2. Retirar UI, acciones de servidor y endpoints de Remotion, sin tocar rutas `/api/production/hyperframes/*`.
3. Retirar el API Express de producción y el control plane del worker; conservar Auth Bridge si continúa siendo usado por `apps/api`.
4. Eliminar directorios, bundles, scripts, Docker/env y paquetes Remotion; regenerar `package-lock.json`.
5. Ejecutar build y pruebas HyperFrames; además comprobar que no quedan imports ni rutas Remotion en código de runtime.
6. Respaldar y validar los registros/objetos históricos.
7. Aplicar la migración de purga de datos y la eliminación de objetos de storage mediante un job idempotente; nunca desde una ruta web.

## Criterios de aceptación

- El ensamblaje de un video sigue abriendo `HyperframesCompositionPanel` y puede guardar, crear snapshot, aprobar y renderizar.
- Ningún bundle, preview, endpoint, worker o dependencia de runtime contiene Remotion.
- Los enlaces antiguos no llevan a una pantalla rota: se retiran de navegación y las rutas eliminadas responden 404/410 de forma explícita durante la ventana de migración.
- Los paquetes `@remotion/*` y `remotion` ya no aparecen en manifests ni lockfile.
- Las pruebas `npm run test:hyperframes --workspace=apps/web` y el build web pasan.
- La purga de tablas y objetos sólo se ejecuta después de que el respaldo histórico quede confirmado.

## Riesgos de regresión a vigilar

- `ProductionAssetCard`, el catálogo de plantillas y el estudio de slides comparten tipos y endpoints con el bundle agent: deben migrarse o retirarse en el mismo cambio.
- El worker de escritorio no es parte del render HyperFrames actual; mantenerlo por compatibilidad dejaría un camino muerto y secretos Remotion activos.
- Los datos `final_video_url` y los assets ya terminados no deben borrarse: son resultados finales, no artefactos Remotion, y pueden seguir siendo referenciados por publicación.
- Los objetos de bundle/template no deben confundirse con los videos finales en `production-videos`.

# Preview local y persistencia del editor

## Diagnóstico

React ya actualizaba el documento optimista, pero el iframe seguía mostrando el documento guardado. La sincronización incremental estaba desactivada por defecto y cubría pocas operaciones. Texto, captions, timing, pistas, transiciones, altas y reemplazos esperaban el PUT y después recompilaban el preview, repitiendo resolución de URLs y preparación de medios.

## Decisión y responsabilidades

1. La cola existente valida el cambio y genera su documento local.
2. Se despacha el patch antes del hash de recuperación y de esperar el guardado. Los cambios DOM simples conservan el protocolo pequeño; las otras operaciones compatibles usan una proyección local de escena/timeline.
3. El iframe reconcilia elementos por identidad y cambia solamente atributos y contenido diferentes. Conserva el `src` exacto de assets existentes y solamente modifica el orden de hermanos cuando cambia el orden canónico.
4. Se revierte el timeline anterior y se instala el nuevo en el mismo iframe, conservando el playhead. El renderizador de clips, la proyección de timing y el planificador GSAP se comparten con la compilación inicial y el render final.
5. El ACK visual habilita reproducción y scrub aunque la persistencia siga pendiente. El badge de guardado permanece independiente.
6. El PUT conserva la cola serial, `If-Match`, el header alternativo de versión, el historial y el journal. Su respuesta confirma la revisión sin cambiar la URL del iframe.
7. Un rechazo, timeout, generación obsoleta, fallo de guardado o conflicto utiliza la recuperación canónica existente. Nunca se confirma un ACK de otro iframe.

El journal marca los cambios intentados en la sesión actual para impedir que el efecto de recuperación los reenvíe al recibir un 500. La recuperación de una sesión interrumpida se conserva al recargar; un fallo visible ofrece reintento explícito.

| Módulo | Responsabilidad |
| --- | --- |
| `composition-clip-renderer.service.ts` | Markup canónico compartido de clips |
| `composition-preview-timeline-state.ts` | Proyección validada de clips, captions, motion, transiciones y audio |
| `composition-preview-timeline-runtime.ts` | Instalación compartida del timeline |
| `composition-preview-scene-patch.ts` | Construcción isomórfica del patch y fallback para dependencias nuevas |
| `composition-preview-scene-runtime.ts` | Preflight y reconciliación DOM conservando identidades |
| `composition-preview-asset-urls.client.ts` | Resolución acotada de URLs de medios nuevos |
| `NativeCompositionPreview.tsx` | Coordinación de UI, ACK y persistencia existentes |

## Assets y seguridad

El sandbox conserva `allow-scripts`, sin habilitar acceso al origen. Los medios nuevos resuelven su URL desde el cliente padre mediante HEAD al endpoint autorizado existente; el redirect no descarga el video completo. Esto avanza en paralelo con el guardado. La caché limita concurrencia a seis peticiones, espera a diez segundos y conserva hasta 500 URLs durante 45 minutos.

Las diapositivas existentes reutilizan HTML y URLs ya procesados en el iframe. El patch nunca introduce HTML nuevo de deck. El texto nativo se escapa mediante el renderer compartido. Se conservan las comprobaciones de origen del mensaje, versión, generación y ACK.

## Límites

- `document.restore`, `document.reconcile`, operaciones desconocidas, CSS de deck nuevo, diapositivas todavía no compiladas y fuentes de organización nuevas utilizan compilación canónica después de persistir.
- Los medios nuevos requieren resolver su URL y decodificarse; su latencia depende de red y navegador.
- Un cambio real del orden de capas puede requerir mover nodos. No se garantiza conservar buffers si el navegador reinicia el medio al moverlo.
- La cola y los bloqueos de edición del inspector siguen preservando el orden de persistencia. Reproducción y scrub quedan disponibles cuando llega el ACK visual.
- El harness del componente simula los endpoints y aísla Storage. Falta QA autenticado y medición p95 con composiciones reales grandes.
- Se observó una dependencia previa de `utils/supabase/client.ts` hacia `lib/server/env.ts`. Separar configuración pública y de servidor merece un cambio dedicado. Esta entrega no modifica ese cliente ni afirma que exista una filtración de credenciales. La separación recomendada puede contrastarse con la [documentación de clientes SSR de Supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

Para extender el protocolo, clasificar una operación como incremental solamente si la proyección representa todo su resultado. Conservar el fallback si introduce dependencias ausentes del sandbox y añadir un caso con ACK, seek y resultado visible al smoke.

## Validación

Desde la raíz:

```bash
npm run typecheck
npm run test:composition-preview-sync --workspace=apps/web
npm run test:hyperframes --workspace=apps/web
npm run qa:composition-preview-runtime --workspace=apps/web
npm run qa:composition-preview-scene --workspace=apps/web
```

Los smokes necesitan Chrome, Chromium o Edge (`CHROME_PATH` en CI). El smoke de escena utiliza sharp y ffmpeg ya disponibles, genera medios sintéticos y guarda su reporte en `apps/web/.tmp/composition-preview-scene-qa/report.json`.

La prueba del componente real retiene el PUT para confirmar que la capa ya aparece y el scrub está habilitado antes de persistir; después verifica éxito sin navegación, rollback ante 500 sin reintento silencioso y recuperación ante 409. Su reporte queda en `apps/web/.tmp/composition-editor-latency-qa/report.json`.

En la validación local, `test:hyperframes` se detuvo en un problema previo del runner CommonJS: `composition-agent-model-output.test.js` no puede resolver `@/lib/server/outbound-http`. Ese import ya existe en HEAD y no fue modificado. Las pruebas específicas del compiler/preview se ejecutaron por separado.

QA manual: editar texto/captions; ajustar duración, crop, volumen con fades y pistas; dividir/eliminar clips; reemplazar fuentes; probar deck y fuente de organización nuevos. Con red lenta, el cambio compatible debe aparecer mientras el guardado sigue pendiente. Simular 500 y editar desde otra sesión para revisar rollback y OCC.

## Operación y reversión

La sincronización queda habilitada por defecto. `NEXT_PUBLIC_COMPOSITION_PREVIEW_SYNC_V2_ENABLED=false` recupera el flujo anterior y requiere reiniciar/recompilar Next. No hay migraciones ni dependencias nuevas.

Revisar `runtime_visual_patch_ms`, `edit_to_visual_update_ms`, `save_roundtrip_ms` e `iframe_reload_ms` por operación. Los cambios compatibles deberían registrar `APPLIED` sin navegación por `SAVE_RECOVERY`. Los tiempos sintéticos no representan latencia de producción ni el coste total de construir el patch.

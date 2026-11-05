# Verificación de fronteras de importación

Fecha de cierre en preparación: 2026-11-05. Estado: código local y regresiones aprobados; integración de staging y compuerta final en curso.

Se separaron contratos de fuentes, fronteras Unicode, planificación pura de captions, descriptor de render y autorización HTTP narrativa. Los exports anteriores siguen disponibles mediante fachadas. Se comprobó por comparación local que los cuerpos de planificación y lectura de fuentes se conservaron con los cambios explícitos de firma, y que el runtime GSAP original es idéntico al del commit previo. No se alteró la configuración de madge ni se excluyeron tipos del análisis.

El primer intento de extracción colisionó con el archivo runtime existente. TypeScript detectó el export ausente; se restauró el runtime original desde Git y se creó composition-caption-effects-planner.ts. No se conserva esa sobrescritura. Las pruebas ampliadas detectaron un import con alias que no resolvía en Node y una expectativa con el nombre anterior del producto: se cambió el import a ruta relativa y se usa APP_CONFIG en la aserción, conservando la estructura exacta del HTML comprobado.

## Evidencia ejecutada

- TypeScript global: aprobado tras corregir la extracción.
- architecture:cycles: 2261 archivos procesados, cero ciclos; 575 avisos del resolver que ya existían. El análisis anterior detectaba once ciclos.
- build:composition-worker: aprobado; necesario para la prueba de materialización operativa.
- Regresiones dirigidas: 181 pruebas aprobadas en trece archivos de captions, fuentes, ejecución controlada, materialización y HTTP narrativo.
- test:hyperframes del workspace: 358 pruebas aprobadas, ninguna fallida. La suite requirió resolver el import y expectativa anteriores; se repitió completa después de corregirlos.
- SQL de autoría e historial: dieciséis pruebas aprobadas localmente; no ejecuta proveedores ni SQL remoto.
- OpenSpec estricto: 35 ítems aprobados. docs:check previo al reporte: 234 documentos válidos.

Salidas locales: .tmp/test-composition-import-boundaries.log, .tmp/test-hyperframes-import-boundaries.log y .tmp/verify-composition-import-boundaries.log. No son artefactos de despliegue ni evidencia de cuenta real.

## Revisión adversarial propia

Se intentó refutar pérdida de validación Unicode, cambio de IDs/orden/presupuesto de captions, ampliación de autorización narrativa, sustitución de contrato de render y exposición de configuración. Los cuerpos extraídos mantienen el algoritmo; las firmas consumen contratos compartidos y las suites existentes ejercitan rechazos/recuperación. Esta revisión la realizó el mismo agente y no se presenta como independiente. No se archiva el cambio antes de su integración.

## Integración y límites

Antes de publicar se detectaron siete commits nuevos en origin/staging de Engine (37dcf7dc). Deben integrarse conservando sus cambios de subtítulos/grupos y repetir las verificaciones afectadas. El historial de la migración aplicada manualmente sigue pendiente de confirmar después de reparar el registro; el usuario respondió sin filas a la consulta inicial. El despliegue, modelo/cuenta real y piloto audiovisual no se consideran verificados por estas pruebas.

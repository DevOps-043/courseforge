# Verificación de fronteras de importación

Fecha de cierre en preparación: 2026-11-05. Estado: staging integrado, regresiones aprobadas y compuerta final en curso.

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

Antes de publicar se detectaron siete commits nuevos en origin/staging de Engine (37dcf7dc). Se integraron con merge 797a66c7 sin conflictos; se conservaron sus cambios de subtítulos/grupos y se repitió HyperFrames: 358 pruebas aprobadas. El análisis acíclico previo mantiene su configuración y la compuerta del producto se repite sobre la integración.

Generar el worker produjo JavaScript bajo dist/composition-worker y ESLint estaba recorriendo esa salida. Se excluyó únicamente esa salida generada, conservando src completo. Los archivos CommonJS de QA incorporados por staging requerían acotar las excepciones React al mismo patrón del preset Next y permitir require en archivos .cjs. No se desactivaron reglas del código TypeScript ni se excluyeron módulos fuente del análisis de arquitectura. Lint global aprobó tras ese ajuste. La nueva ejecución del producto tras el merge aprobó lint, tipos, cero ciclos y guard de 214 migraciones; las suites posteriores siguen su ejecución en .tmp/verify-product-synchronous-release.log.

El historial de la migración aplicada manualmente sigue pendiente de confirmar después de reparar el registro; el usuario respondió sin filas a la consulta inicial y tiene el SQL de reparación acotado. El despliegue, modelo/cuenta real y piloto audiovisual no se consideran verificados por estas pruebas. El acceso de navegador está deshabilitado en la sesión y no hay conexión Netlify; las ramas GitHub no acreditan despliegue web.

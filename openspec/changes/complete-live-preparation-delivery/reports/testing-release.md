# Candidato coordinado para pruebas

Fecha: 2026-11-05. Rama: codex/complete-synchronous-system. Estado: código publicado en los tres repositorios y verificación de producto aprobada; paquete Windows, despliegue web y piloto real en seguimiento.

Learning y Hub ya tienen la rama remota publicada. Learning aprobó nuevamente 171 pruebas en 27 archivos. Hub aprobó build:app y el smoke nativo del programa (vídeo estable, audioTransport, audioMix, cameraOverlay, sceneRecovery y receptorAislado). Su empaquetado Windows se prepara sin publicación automática.

Engine incorporó origin/staging 37dcf7dc con merge 797a66c7, conservando los siete commits ajenos nuevos. La corrección del grafo retiró los once ciclos sin excluir fuentes del análisis. Después de la integración aprobaron 358 pruebas HyperFrames, npm run verify completo (297 pruebas, tipos/lint y cero ciclos; código 0) y verify:harness separado (código 0, 20 pruebas). La compilación del worker y 181 regresiones dirigidas habían aprobado antes del merge; consultar la [evidencia del ajuste de imports](../../remove-composition-import-cycles/reports/verification.md).

La guía de recorrido y orden de publicación está en docs/operations/synchronous-testing-release.md del repositorio Hub. Publicar Learning primero, luego Engine/Hub. El diagnóstico de configuración usa nombres y booleanos; no compartir valores de secretos en evidencia. Engine se habilita globalmente mediante SYNCHRONOUS_COURSES_ENABLED y conserva permisos de curso; el valor debe configurarse en el entorno administrado para probar el flujo, no por editar archivos locales versionados.

El usuario confirmó que no había filas en la consulta del historial de 20261026160000; la reparación acotada está preparada y pasó dieciséis pruebas SQL locales. Su ejecución/fila final sigue pendiente de confirmación. No repetir la migración de negocio ni hacer db push general para resolver ese pendiente.

El navegador está deshabilitado en esta sesión y no hay conexión Netlify ni CLI autenticada disponible. La publicación Git no acredita una URL de deploy, variables administradas, worker remoto vivo, cuenta Zoom ni una llamada real. No se presentan como completados. No se ha fusionado main ni se ha alterado un sitio productivo.

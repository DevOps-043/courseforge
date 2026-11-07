# Evidencia local

- `qa:composition-toolbar-layout --workspace=apps/web` pasó en Chromium. El historial de Entrega quedó dentro del viewport, por encima del editor y con scroll interno en 1365 × 768 y 390 × 420. Escape y el clic en el fondo cerraron el diálogo y devolvieron el foco al botón Versiones. La suite también verificó los controles existentes en seis anchos.
- El acceso a DevTools en localhost requirió ejecutar la prueba de navegador fuera del sandbox de red.
- Pasaron `npm run lint`, `npm run openspec:validate`, `npm run docs:check` y `git diff --check`.

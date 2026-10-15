---
name: verify-change
description: Selecciona verificaciones proporcionales y conserva evidencia real.
---

# verify-change

1. Traducir escenarios del cambio a una matriz de éxito, errores y permisos.
2. Leer docs/standards/testing.md y seleccionar scripts reales del dominio.
3. Para el arnés, ejecutar npm run verify:harness; para entrega, npm run verify:pr.
4. CI mantiene además compliance, build, audit y QA visual: no afirmar que se ejecutaron localmente si no ocurrió.
5. Conservar salida y código de cada paso; separar línea base demostrada de hipótesis.
6. Registrar límites y fallos en reports/ del cambio; no relajar verificadores para obtener verde.

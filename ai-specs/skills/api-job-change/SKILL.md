---
name: api-job-change
description: Revisa cambios que cruzan rutas Next.js, servicios de dominio y jobs de Netlify.
---

# api-job-change

1. Leer docs/standards/web-and-jobs.md y el contrato actual del consumidor.
2. Validar schema, tamaño, autenticación, rol y organización en servidor.
3. Mantener negocio en dominio, errores seguros y correlación en la frontera.
4. Para background, preservar firma/credencial, expiración y controles de repetición.
5. Diseñar timeout, cancelación, idempotencia y estados parciales antes del efecto.
6. Probar contrato, acceso denegado y reintento seguro con suites existentes; no iniciar generación pagada como prueba.

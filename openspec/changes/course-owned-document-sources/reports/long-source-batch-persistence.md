# Verificación local de persistencia por lotes

- `node --test --test-name-pattern 'lotes documentales' scripts/test-course-source-migration.mjs`: dos pruebas aprobadas. Ejecutan la migración en PostgreSQL aislado y comprueban cobertura exacta, creación y confirmación idempotentes, división ordenada, cita inventada, bloqueo de una segunda reserva, vencimiento del lease, aislamiento por organización y permisos del navegador.
- La segunda prueba verifica la espera entre intentos, la pausa tras una segunda salida inválida y la conservación del presupuesto global tras reanudar.
- `npm run db:migrations:check`: aprobado, 221 archivos de migración.
- Suite SQL completa: 24 pruebas aprobadas. OpenSpec estricto del cambio: aprobado.

La exclusión de leases se prueba mediante solicitudes sucesivas sobre la misma base aislada. La prueba de contención entre conexiones reales, la integración del worker y el piloto quedan pendientes. Sin SQL remoto ni llamadas a modelos.

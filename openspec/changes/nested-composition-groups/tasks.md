# Tareas de implementación

Estado: código implementado localmente. Evidencia, fallos generales previos y
límites en [el informe de entrega](reports/implementation.md). No se aplicó SQL remoto.

## 0. Preparación y contrato
- [x] Aislar el trabajo y conservar cambios anteriores; registrar base y rama de entrega.
- [x] Inventariar lectores/escritores, RPCs, reconciliación, agente e historial.
- [x] Fijar groupingVersion/childGroupIds, profundidad 8, normalización y orden.
- [x] Crear fixtures legacy, mixtos, inválidos y referencias de compilación.
- [x] Definir negociación de cliente, flag de servidor, guards y rollback.

## 1. Modelo compatible
- [x] Implementar schemas duales sin reescritura ni cambio de hash al leer.
- [x] Implementar índices, padres, raíces, hojas, bounds y validación acotada.
- [x] Probar ciclos, duplicados, referencias, profundidad, límites y entrada masiva inválida.
- [x] Preparar migraciones aditivas con helpers privados y guard transversal de inserción.
- [x] Ejecutar paridad TS/SQL, versión legacy y límites 250/500 en PGlite.
- [x] Implementar capacidad SQL confirmada, timeout, caché y creación desactivada por defecto.

## 2. Operaciones y persistencia
- [x] Implementar wrap de hermanos, grupos mixtos y membresía atómica.
- [x] Compartir el reducer de agrupación con la proyección de duración.
- [x] Adaptar movimiento, desagrupación, add/remove y promoción en cascada.
- [x] Mantener padre directo de clips derivados y normalización al eliminar.
- [x] Reconstruir copias jerárquicas con IDs nuevos y presupuesto de operaciones existente.
- [x] Adaptar extracción y delta SQL; rechazar selección parcial y pérdida de jerarquía.
- [x] Verificar vínculos avatar–voz, pistas bloqueadas, límites y ausencia de efectos parciales.
- [x] Probar tenant/rol, origen USER/SYSTEM, hash, restauración y rechazo de versión obsoleta.
- [x] Implementar handshake y guard de downgrade desde append, wrapper e inserción directa.
- [x] Mantener snapshots/rebase y recuperación de conflictos; actualizar UI después de ACK.

## 3. Interfaz
- [x] Resolver unidades por nivel desde hojas/contexto con una función pura compartida.
- [x] Seleccionar grupos hermanos con selección aditiva y elegibilidad centralizada.
- [x] Implementar ruta, entrada/salida y Escape por nivel; limpiar no abandona el grupo.
- [x] Adaptar overlays, colores, arrastre de descendientes y controles internos.
- [x] Verificar en Chromium selección Shift, capacidad, wrap, ruta, dos niveles, Escape y ungroup.

## 4. Verificación y documentación local
- [x] Verificar equivalencia exacta de HTML de preview/render al agrupar sin mover.
- [x] Verificar la fixture máxima del grafo y registrar coste SQL, sin prometer un SLO.
- [x] Ejecutar pruebas nuevas, regresiones, seguridad, arnés y guards SQL; registrar resultados.
- [x] Ejecutar compuertas; conservar visibles bloqueos previos de OpenSpec, ciclos y otras suites.
- [x] Realizar revisión adversarial propia, sin afirmar independencia.
- [x] Actualizar contrato canónico multimedia, especificaciones, informe y reproducción.
- [x] Añadir pruebas nuevas, SQL aislado y smoke de Chromium a CI.
- [x] Documentar orden de despliegue y reversión compatible.

## 5. Integración y habilitación externas
- [ ] Resolver fallos generales previos antes de integrar; no debilitar gates.
- [ ] Ejecutar CI/build y QA visual del editor completo, foco/gestos y fluidez con muchos clips.
- [ ] Probar migraciones en Supabase descartable con esquema y RLS reales.
- [ ] Aplicar SQL remoto y habilitar piloto únicamente con autorización y evidencia completa.
- [ ] Archivar OpenSpec después de integrar en la rama objetivo.

## 1. Contrato y fronteras del receptor

- [x] 1.1 Diagnosticar emisor/receptor y registrar plan, límites y aceptación.
- [x] 1.2 Implementar contrato portable de identidad, currículo y recorrido v2 con fixtures.
- [x] 1.3 Rechazar versiones/metadatos incompatibles en recepción, aprobación e importador legacy antes de escribir.
- [x] 1.4 Verificar paridad Zod 3/4, regresiones v1 y rechazos sin efectos secundarios.

## 2. Persistencia y aprobación de Academy

- [x] 2.1 Diseñar migraciones aditivas de identidad externa, revisiones, recorrido y plantillas con RLS y restricciones.
- [x] 2.2 Incorporar el snapshot completo de preparación y archivos al contrato v2, reutilizando los validadores existentes.
- [x] 2.3 Implementar recepción idempotente por organización/artefacto/revisión y confirmación de entrega.
- [ ] 2.4 Implementar aprobación transaccional y vínculo por identidad estable, sin borrar progreso ni reasignarlo por orden.
- [ ] 2.5 Probar PostgreSQL aislado: rollback, tenants, versiones obsoletas, duplicados, reordenación y progreso.

## 3. Emisión y experiencia

- [ ] 3.1 Construir paquete desde aprobaciones vigentes y negociar capacidad del receptor en servidor.
- [ ] 3.2 Conectar outbox al receptor v2 y separar confirmaciones de recibido/aprobado/rechazado en UI.
- [ ] 3.3 Ampliar preview administrativo y programación de plantillas aprobadas, sin inventar fechas.
- [ ] 3.4 Habilitar híbrido únicamente después de comprobar contratos y permisos de ambos extremos.

## 4. Verificación y activación

- [ ] 4.1 Ejecutar pruebas dirigidas y compuertas proporcionales en ambos repositorios.
- [ ] 4.2 Completar revisión adversarial y documentación operativa/recuperación.
- [ ] 4.3 Preparar migraciones y despliegue revisables; solicitar autorización final si no está cubierta.
- [ ] 4.4 Verificar taller recibido, aprobado y asignado y paneles reales de instructor/participante en Hub.

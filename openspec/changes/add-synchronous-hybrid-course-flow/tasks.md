# Tareas de implementación

Estado: implementación local bajo habilitación. Los checks indican código/verificación local, no despliegue ni piloto; ver reports/implementation.md para los límites. Las entregas E0 a E7 corresponden al [plan](../../../docs/architecture/synchronous-hybrid-course-implementation-plan.md); no son nuevas etapas del producto.

## E0. Diseño y decisiones

- [x] E0.1 Revalidar evidencia, rama objetivo y aislamiento recuperable para implementación material.
- [x] E0.2 Cerrar D1 a D6 según dependencia y registrar decisiones de producto.
- [x] E0.3 Diseñar contratos, errores, límites, operaciones, permisos y retención.
- [x] E0.4 Diseñar DDL aditivo, integridad, RLS, revisiones, transacciones, consultas e índices justificados.
- [x] E0.5 Reproducir desalineación de índices de publicación y acotar corrección necesaria.
- [x] E0.6 Fijar estrategia de habilitación, rollback y fixtures de aceptación.

## E1. Fundamentos

- [x] E1.1 Implementar modalidad y política compartida de requisitos/aplicabilidad con compatibilidad Nexus.
- [x] E1.2 Crear y validar migraciones locales aditivas según E0; sin SQL remoto automático.
- [x] E1.3 Implementar repositorios, autorización tenant-aware y pruebas de acceso cruzado.
- [x] E1.4 Implementar revisiones, invalidación selectiva y controles atómicos de aprobación/escritura.
- [x] E1.5 Probar cursos legacy y recuperación sin pérdida de contenido aprobado.

## E2. Configuración de modelos y prompts

- [x] E2.1 Registrar capacidades de agenda, plan y materiales sincrónicos en catálogo, tipos, UI, validadores y persistencia.
- [x] E2.2 Implementar resolución organización/global y herencia explícita de etapa; error de lectura diferenciado.
- [x] E2.3 Registrar prompts editables/versionados y composición modular con contratos protegidos.
- [x] E2.4 Revisar permisos de configuración global/tenant y de instrucciones temporales; mostrar configuración efectiva.
- [x] E2.5 Fijar instantánea reconstructible por ejecución, procedencia y modelo efectivo principal/respaldo.
- [x] E2.6 Probar precedencia, aislamiento, incompatibilidad de modelo, reintento y cambio de configuración en curso.

## E3. Agenda y plan

- [x] E3.1 Integrar modalidad en Base y agenda en Temario sin duplicar captura.
- [x] E3.2 Implementar sesiones con identidad estable, cobertura parcial/repaso, duración y validación.
- [x] E3.3 Generar/editar agenda solo sobre syllabus aprobado usando configuración E2.
- [x] E3.4 Implementar planes de sesión y coordinación híbrida conservando planes Nexus.
- [x] E3.5 Coordinar generación por unidad y aprobación única de Plan con versiones actuales.
- [x] E3.6 Probar cobertura, tiempos imposibles, edición concurrente y agenda obsoleta.

## E4. Fuentes

- [x] E4.1 Adaptar necesidades de sesiones y combinar cobertura con Nexus.
- [x] E4.2 Reutilizar fuentes pertinentes y buscar brechas sin duplicar el motor.
- [x] E4.3 Propagar revisión de fuente rechazada a contenido dependiente.
- [ ] E4.4 Probar curación existente y sincrónico sin lecciones Nexus ficticias.

## E5. Materiales

- [x] E5.1 Implementar unidades de sesión y contenido estructurado separado del almacenamiento Nexus por lección.
- [x] E5.2 Generar conceptos, preparación, actividades, respuestas, notas y fuentes en forma coordinada.
- [x] E5.3 Proyectar audiencias en servidor y conservar identidad de actividades.
- [x] E5.4 Implementar progreso, concurrencia limitada, idempotencia y recuperación parcial con configuración fijada.
- [x] E5.5 Probar duplicados, resultado tardío, fallo parcial y conservación de contenido aprobado.

## E6. Producción y entrega

- [x] E6.1 Adaptar slides al contenido de sesión sin video previo y conservar notas/guía sin truncado silencioso.
- [x] E6.2 Implementar formatos confirmados para presentación, guía y cuaderno desde contenido común.
- [x] E6.3 Implementar paquete/manifiesto por audiencia, revisiones, integridad, acceso y retención.
- [x] E6.4 Integrar preparación/descarga en etapa final preservando publicador Nexus.
- [x] E6.5 Completar QA visual y pruebas de privacidad, vigencia, exportación y ausencia de render obligatorio.

## E7. Integración y operación

- [x] E7.1 Integrar ocho etapas, resúmenes y Ensamble «No requerido», sin aprobaciones nuevas.
- [ ] E7.2 Cubrir cambios de modalidad, entradas obsoletas y coordinación híbrida extremo a extremo.
- [x] E7.3 Registrar suites nuevas en scripts reales y compuerta correspondiente sin debilitar verificaciones.
- [ ] E7.4 Ejecutar verificaciones aplicables, regresión Nexus/publicación y revisión adversarial documentada.
- [ ] E7.5 Documentar métricas, diagnóstico, reanudación, limpieza de huérfanos y rollback; obtener línea base.
- [ ] E7.6 Ejecutar piloto/habilitación únicamente en entorno y organización autorizados; registrar resultados.
- [ ] E7.7 Sincronizar documentación de capacidades implementadas y evidencia; archivar OpenSpec solo tras integración objetivo.

## Pendientes de cierre

E4.4 y E7.2 requieren el recorrido autenticado completo de las modalidades; las suites y adaptadores locales no lo sustituyen. E7.4 tiene verificaciones locales y revisión del mismo agente, pero verify:pr no está verde. E7.5 conserva guía y fixtures, pendiente de línea base real. E7.6 necesita piloto autorizado. E7.7 no se cierra ni archiva antes de integración.

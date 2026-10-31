# Tareas de implementación

Todas las tareas de producto están pendientes. El plan no autoriza despliegues
ni aplicación de SQL remoto. Dependencias: fase 1 después de 0; 2 después de 1;
3 después de contratos estables de 2; habilitación después de todas las verificaciones.

## 0. Preparación y cierre del contrato
- [ ] Aislar implementación en rama/worktree y registrar base, preservando trabajo ajeno.
- [x] Registrar inventario estático de consumidores semánticos y familias genéricas, incluidos RPCs, agentes y restauración, en technical-closure.md.
- [x] Fijar esquema groupingVersion/childGroupIds, profundidad máxima de 8, normalización y orden.
- [ ] Crear fixtures legacy, árboles mixtos, casos inválidos y referencias audiovisuales.
- [x] Identificar guards/RPCs versionados de extracción y fijar estrategia SQL aislada con PGlite; ejecución pendiente en fase 1.
- [x] Definir capacidad de cliente, marcador persistente, flag servidor y rollback compatible.

## 1. Modelo compatible
- [ ] Implementar schemas legacy/jerárquico sin reescritura al leer ni cambio de hashes históricos.
- [ ] Crear servicio puro de índices, parentesco, hojas, bounds y validación acotada del grafo.
- [ ] Probar ciclos, padres duplicados, referencias inválidas, profundidad y tamaños máximos.
- [ ] Preparar migración aditiva de guards y verificadores SQL; conservar permisos restringidos.
- [ ] Probar paridad de validación TS/SQL y compatibilidad con documentos planos.
- [ ] Agregar habilitación de escrituras jerárquicas en servidor, inicialmente desactivada.

## 2. Operaciones y persistencia
- [ ] Extender group.create para envolver hermanos sin perder IDs ni relaciones internas.
- [ ] Adaptar move, ungroup, add/remove-clips y normalización en cascada.
- [ ] Adaptar split/remove-range/remove y verificar padres de clips derivados.
- [ ] Adaptar copia/duplicación/pegado con reconstrucción de hijos a padres y nuevos IDs.
- [ ] Adaptar extracción narrativa y su delta SQL; impedir selección parcial y bypass de voz agrupada.
- [ ] Verificar vínculos avatar–voz dentro/fuera del subárbol y movimientos atómicos.
- [ ] Probar permisos tenant/rol, origen USER, restauración, hashes, ACK y conflictos concurrentes.
- [ ] Implementar handshake X-Composition-Grouping-Version y bloqueo de escrituras incompatibles, incluido guard SQL de downgrade; probar sesiones antiguas.

## 3. Interfaz
- [ ] Representar selección como unidades explícitas, con clips afectados derivados.
- [ ] Sustituir supuestos clip→grupo único por padre directo y ruta de ancestros.
- [ ] Implementar contexto de navegación, ruta, entrada/salida y selección de hermanos.
- [ ] Adaptar contenedores del timeline, colores, expansión y selección entre pistas.
- [ ] Centralizar elegibilidad de agrupar para panel, handlers y atajos.
- [ ] Integrar autoguardado/historial por acción y recuperación de conflictos.
- [ ] Ejecutar QA visual y teclado: Ctrl/Cmd, Shift, Escape, foco y mensajes accesibles.

## 4. Cierre y habilitación
- [ ] Verificar equivalencia de preview/render/audio al agrupar sin mover.
- [ ] Medir validación, selección y navegación con los límites máximos del documento.
- [ ] Ejecutar suites proporcionales, pruebas SQL aisladas y gates de entrega; registrar resultados.
- [ ] Realizar revisión adversarial de bypass, corrupción, compatibilidad y estados parciales.
- [ ] Actualizar fuente canónica multimedia y contrato operativo sin sobrescribir cambios ajenos.
- [ ] Documentar orden de despliegue, piloto, condiciones de habilitación y rollback compatible.
- [ ] Habilitar piloto solo con autorización de despliegue/SQL y evidencia completa.
- [ ] Archivar OpenSpec únicamente después de integrar en rama objetivo.

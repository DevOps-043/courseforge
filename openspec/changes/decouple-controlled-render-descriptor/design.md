# Diseño

El descriptor contiene exactamente organizationId, revisionId, executionId,
documentHash, projectHash y el CompositionConformanceContract existente. Este
último es la salida del mismo schema usado por el contexto de autoridad anterior.
El descriptor no contiene claves, credenciales, leases ni grants y no valida o
concede autoridad por sí mismo. La validación efectiva sigue en los servicios.

El supervisor conserva ControlledSupervisorRenderer y su resultado. El executor
materializado conserva workspace, measurement plan, controles y retorno. Fence,
materialización, selección y medición consumen directamente el descriptor en
vez de Parameters de esos adaptadores. No se traslada su implementación.

Comparar emisión CommonJS con Git y verificar equivalencia de tipos con el
contexto de autoridad. Ejecutar pruebas existentes del flujo de QA y el grafo
incluyendo tipos; no usar exclusiones para declarar que desaparece la componente.

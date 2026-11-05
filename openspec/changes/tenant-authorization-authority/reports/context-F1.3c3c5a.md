# Continuidad F1.3.c.3.c.5.a — 2026-11-05

Base d3bd9d4a, staging. Unidad cerrada localmente. Biblioteca de plantillas; el lote padre slides/open-design
y TD-26 permanecen abiertos. No cambia el objetivo global del plan.

## Diagnóstico y alcance

El Server Action escogía organización desde active_organization_id/organization_ids
del bridge o cookies antes del resolver vigente. Un fallo del resolver terminaba
como éxito vacío y los errores inesperados exponían su mensaje al cliente directo.
Eso permitía omitir la autoridad actual antes del cliente service-role.

Se elimina ese fallback: identidad autenticada y resolver vigente preceden al
cliente privilegiado. Las tres consultas mantienen filtros por organización,
proyección, orden y límite existentes. Ausencia de tenant devuelve success false
y TENANT_FORBIDDEN; ambas clases internas de indisponibilidad devuelven
DEPENDENCY_UNAVAILABLE. El resultado conserva success/error y añade errorCode
serializable. La ruta HTTP proyecta 403/503 y mantiene 401/500/DTO; respuestas
sin caché, con Vary Cookie y correlación. No basta falsificar name/code.

Los mensajes inesperados ya no salen al cliente ni se registran crudos. El log
estructurado conserva una etapa fija (autoridad, ejecuciones, detalles o
proyección); no contiene cookies, claims ni valores de consultas.

La página admin/templates ya muestra errores cuando success es false. El picker
y ProductionAssetCard también manejan ese resultado y no cachean el fallo.
No se modifica UI ni se acredita QA visual. Tampoco se modifican schemas,
composición, render, CSP de preview, Storage, SQL o trabajos asíncronos.

## Evidencia local

Salidas conservadas en .tmp/module-graph/f1-3c3c5a-*.log:

- before: primero se corrigió la fixture que pasaba un argumento a un constructor
  sin argumentos. La caracterización compilada posterior terminó 1: 188/197
  aprobadas, nueve fallos esperados en las once pruebas nuevas. Reprodujo uso de
  claims ajenos, falso éxito vacío, respuestas incorrectas y mensajes internos.
- auth: código 0; contrato 15/15 y grupo de autoridad 197/197 (once nuevas).
- node22: código 0; once nuevas 11/11 con Node 22 instalado en caché, offline.
- lint-initial: código 1 por dos tolerancias obsoletas, cero errores y 570 warnings.
  Se retiraron solo las huellas del catch any eliminado y la variable sin uso del
  fallback retirado; no se agregaron tolerancias ni se relajaron verificadores.
- gate: código 1 por permisos al crear .git/config de repositorios temporales
  del arnés. No llegó a validar producto; no se atribuye a este cambio funcional.
- gate-retry: código 0 fuera de esa restricción; verify:pr completo, 39 pruebas
  de arnés, 48 cambios OpenSpec, lint cero errores/570 warnings sin diferencias,
  tipos, migraciones y verificación de producto (incluidos seguridad, diseños
  importados, generación de slides, audio y entrega de cursos). Grafo: 2.292
  módulos, 8.961 aristas, cero ciclos/desconocidos, dos referencias justificadas
  del bundler. CI/build/compliance/QA visual no ejecutados por este comando.
- docs-final y openspec-final: código 0 tras actualizar continuidad; 325
  documentos y 48 cambios válidos. git diff --check sin errores.

Los tests ejecutan Server Action y GET reales encadenados, con clases de error,
contrato API y NextResponse reales. Fronteras de identidad, tenant, DB, preview
y validación de diseño importado simuladas; no se acredita render o importación.
Claims/cookies hostiles no se consultan. Se comprueban tres filtros de
organización y DTO con datos; vacío válido; ausencia de sesión/tenant; ambas
clases en identidad y tenant; error genérico, error de DB y clase falsificada.
Denegación/caída impiden crear el cliente privilegiado. Canarios sensibles no
aparecen en los resultados ni en los campos registrados.

## Revisión y continuidad

No hay migraciones nuevas. La aceptación real de membresías/RLS/Storage y UI
permanece pendiente en entorno autorizado; los dobles no la sustituyen.
Revisión adversarial por el mismo agente: se revisaron las tres consultas, el
orden de autoridad/cliente privilegiado, los consumidores existentes, el contrato
serializable y las huellas retiradas. No es una revisión independiente.
Para revertir, revertir el commit de esta unidad; reintroducir el fallback
volvería a permitir la selección insegura, por lo que debe preferirse una
corrección posterior. No hubo publicación ni servicios externos.

Siguiente unidad F1.3.c.3.c.5.b: ocho handlers pendientes (preview de plantilla,
html-preview, jobs, appearance, generate, animated-deck/prepare, open-design/export
y open-design/html-to-png). Preservar CSP, límites, firmas, idempotencia y
compensaciones; después continuar el inventario y las fases del plan principal.

# Continuidad F1.3.c.3.c.7.b.2.c.2 — 2026-11-05

Base 6a4698b7. Plan previo: corregir autoridad de siete acciones de ajustes
(prompts, modelos e historial; editar, restaurar default/versión y modelos).
Retirar rol global y cookie como fallback cuando no hay tenant vigente.

Separar resolución de acceso en módulo servidor: identidad uniforme, actor ligado
al tenant y UUID válidos; lecturas conservan acceso de miembro vigente, escrituras
exigen revisión local. Capturar el contexto una sola vez y reutilizarlo en scope
y revalidación. Ninguna escritura de esta UI podrá modificar defaults globales.
Conservar defaults globales como baseline de lectura para una organización válida.

Reproducir las siete acciones reales con consultas simuladas; negar sin clientes
privilegiados cuando falta tenant o corresponde a otro actor. Probar claims/global
role/cookie ajenos, errores conocidos, caminos permitidos, filtros y organización
de cada escritura. No ejecutar DB real ni modificar SQL remoto. Mantener estados
parciales preexistentes identificados sin atribuir atomicidad que no exista.

## Cambio de criterio solicitado

Durante el trabajo el usuario pausó el objetivo exhaustivo y pidió cerrar la deuda
con lo necesario para funcionar, sin corregir al 100 %. Esta entrega termina el
arreglo de seguridad ya iniciado y verifica el estado local. No prosigue por los
159 candidatos ni ejecuta las fases restantes por iniciativa automática. El plan
completo y sus aceptaciones siguen como backlog, no como trabajo completado.

## Evidencia y alcance

Antes del cambio: compilación correcta; 30 tests de las siete acciones reales,
12 pasan y 18 fallan. El fallo reproduce acceso privilegiado con tenant ausente
y fallbacks, errores conocidos no serializados y relectura de contexto; no se
ejecutaron ataques contra datos reales. Log local
.tmp/module-graph/f1-3c3c7b2c2-before.log.

Se incorpora settings-access.server como única frontera de autoridad. Se retiran
getSettingsEditor/getResolvedActiveOrgId y los imports de sesión/cookie antiguos.
El contexto capturado aporta organización y actor; revalidación usa el slug ya
resuelto. No hay acceso sin organización vigente ni edición global por esta UI.
El update por ID de modelo conserva organización y tipo también en el filtro.
No se cambian algoritmos de versionado, defaults o selección de modelo.

Las 30 pruebas verifican las siete acciones, tenant ausente/ajeno/inválido,
dos clases por identidad/tenant (28 combinaciones), rol local de constructor,
caminos permitidos, filtros/payloads y rechazo de prompt ajeno. Se usan acciones,
helper y clases reales con SDK/DB/roles simulados. No se leen secretos ni se usan
credenciales, DB/Storage o cookies reales. La fixture carga la frontera nueva
solo cuando la acción la importa; la reproducción anterior ejecuta las acciones
antiguas sin sustituir su autorización por la corregida.

Primera suite tras el arreglo: código 0, contrato 15/15 y autoridad 657/657.
Tras retirar ramas globales inalcanzables: suite completa de autoridad código 0,
657/657 más contrato 15/15. Node 22 offline: código 0, 30/30 de ajustes.
verify:pr completo: código 0; lint cero errores y 570 advertencias sin diferencias
con baseline. Grafo 2321 módulos, 9114 aristas, cero ciclos, dos referencias de
bundler justificadas y ninguna sin resolver. docs:check código 0, 337 documentos;
OpenSpec estricto código 0, 48/48. diff --check correcto.
Logs .tmp/module-graph/f1-3c3c7b2c2-*.log. Cierre local de esta entrega funcional,
sin atribuir cierre al plan exhaustivo pausado.

## Límites de la entrega

Sin despliegue, publicación, SQL remoto, generación o cambio de configuración local.
Revisión propia, no independiente. Trabajo heredado preservado; reversión por commit
local. No se afirma aceptación de CI/build/QA visual ni permisos reales de BD.
El versionado de prompts y batch de modelos mantienen sus escrituras múltiples
preexistentes; esta entrega no acredita atomicidad o recuperación de esos efectos.
Las mejoras de integridad, validación exhaustiva, mensajes generales de proveedor
y el resto de la auditoría quedan pendientes y no se presentan como corregidas.

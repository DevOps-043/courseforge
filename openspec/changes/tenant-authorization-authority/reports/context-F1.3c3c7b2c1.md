# Continuidad F1.3.c.3.c.7.b.2.c.1 — 2026-11-05

Base 8f8fb474. Alcance previo: inventario AST de emisores y consumidores de
identidad/tenant y reproducción de fallo de observabilidad en emisores centrales.
tenant-memberships y getOrganizationPlatformRole registran en console.error antes
de lanzar TenantContextLookupError. Si el logger falla, pueden perder la clase
que las fronteras HTTP clasifican como indisponibilidad de autoridad.

Probar servicios reales con dobles locales de consultas y console aislada en VM;
verificar clase, código y mensaje seguro, sin fallback ni lecturas posteriores.
Contener solo el fallo de observabilidad, manteniendo la excepción conocida.
No cambiar política de retry, cache, membresía o autorización.

El inventario será evidencia de alcance, no prueba de seguridad de todos los
consumidores. Continuar por catches reales y acciones después del corte. Sin
secretos, SQL remoto, servicios reales, publicación, despliegue o generación.
## Inventario y reproducción

authority-consumer-inventory.mjs inspecciona fuentes TypeScript/TSX versionadas,
excluye tests/fixtures y no ejecuta producto. Usa AST del TypeScript instalado,
conserva HEAD, hashes, imports/alias, llamadas, emisores, métodos HTTP y catches.
El JSON es un corte previo a modificar los dos emisores, base 8f8fb474; los cambios
de tests ya existentes en el árbol se registran como metadata, no como fuentes
de producto. Sus hashes no se presentan como estado posterior al arreglo.

Corte: 159 archivos candidatos, 385 llamadas, cuatro archivos emisores, 108 archivos
HTTP y diez candidatos a acciones de servidor. La clasificación es léxica/AST:
no sigue todo el grafo transitivo, no certifica captura efectiva y puede requerir
reclasificación manual. Emisores directos observados: server-identity, session,
tenant-context y tenant-memberships. No asumir que nombres encontrados bastan
para cerrar F1.3. Primera invocación usó cwd incorrecto; corregida desde raíz,
código 0. El generador protege cortes existentes y permite destino JSON local.

Compilación inicial correcta. Suite tenant antes del arreglo: código 1, 11 tests,
nueve previos pasan y los dos nuevos fallan porque CANARIO_PRIVADO_LOGGER sustituye
a TenantContextLookupError. Log .tmp/module-graph/f1-3c3c7b2c1-before.log.

## Cambio y validación

Solo se contiene console.error de los dos caminos de error, preservando texto
neutral, clase, code/retryable, consultas, filtros, retry y cache. El fixture de
tests captura console en VM; no modifica la consola global. Se verifica una sola
llamada de log sin detalles del proveedor y cero lecturas de rol cuando falla
membresía; una lectura de rol cuando falla su consulta. Servicios, clase y parser
reales; SDK/consultas/retry/cache simulados. No se acredita timeout real, RLS o
persistencia/cookies de producción.

- test:auth-bridge: código 0, contrato 15/15 y autoridad 627/627, incluidas dos
  regresiones nuevas. Node 22 offline: código 0, 11/11 en suite tenant.
- verify:pr completo: código 0. Lint cero errores, 570 advertencias sin diferencias
  con baseline; grafo 2318 módulos, 9101 aristas, cero ciclos, dos referencias de
  bundler justificadas y ninguna sin resolver. Incluye migraciones locales, sin SQL
  remoto. docs:check: código 0, 336 documentos; OpenSpec estricto: código 0, 48/48.
- Generador repetido sin --replace: rechazo esperado código 1 y hash del JSON
  preservado; no sobrescribe el corte. diff --check correcto.
- Logs locales .tmp/module-graph/f1-3c3c7b2c1-*.log.

## Hallazgos y siguiente acción

La inspección manual de app/admin/settings/actions.ts detectó dos fallbacks de
autoridad que requieren corrección prioritaria: getSettingsEditor consulta rol
global del perfil cuando no hay tenant; getResolvedActiveOrgId acepta entonces
getActiveOrganizationId (cookie). Lecturas de prompts/modelos usan ese scope con
cliente privilegiado, y escrituras lo combinan con el editor global. Es un riesgo
concreto de acceso entre organizaciones y/o alcance global sin membresía vigente;
la explotación no se probó con datos reales. No atribuir autoridad a esa cookie
ni dar por seguro el fallback global. Próxima .7.b.2.c.2: reproducir y corregir
ambos paths con mínimo privilegio, incluyendo lecturas, escrituras y errores.

profile/actions.ts también puede fallar en revalidación tenant después de una
mutación ya realizada; requiere conservar estado parcial sin repetir password o
perfil. Es un hallazgo de continuidad, no una corrección acreditada en este corte.
Los diez candidatos de acciones y los consumidores indirectos siguen pendientes.

Revisión propia, no independiente. Sin secretos, consultas remotas, despliegue,
publicación o generación; no se ejecutó build/CI/QA visual. Se preserva trabajo
heredado. Reversión por commit local. El padre .7.b.2.c y todas las fases del
objetivo permanecen abiertos, incluida aceptación real de seguridad.

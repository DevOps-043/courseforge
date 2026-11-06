# Diseño del seguimiento

## Decisiones
El informe vigente se enruta desde TECHNICAL_DEBT_AUDIT.md; el contenido anterior
se conserva como historial. docs/technical-debt/ mantiene cobertura, registro,
plan y medición separados por responsabilidad, sin duplicar contratos de dominio.
Los IDs TD-01 a TD-25 se conservan; los nuevos comienzan en TD-26.

El plan de corrección se refina en seis fases y 25 unidades iniciales, con una
unidad por chat como orientación, no como garantía de capacidad. Los presupuestos
de contexto son heurísticos; las decisiones y pruebas se persisten antes de un
corte. La plantilla de continuidad vive en reports/ y se instancia en el OpenSpec
de cada corrección, sin duplicar estados entre informes. La autorización tenant
puede corregirse tras su caracterización sin esperar todo el historial SQL ni UI.

Se distingue estado del trabajo de calidad de evidencia. Un hallazgo planificado
puede tener lógica validada localmente y exposición productiva pendiente.
No se heredan cierres ni porcentajes de otra fecha. Los conteos del inventario
describen superficie, nunca calidad o capacidad.

## Alternativas
Reemplazar el informe anterior perdería historial. Abrir un backlog sin enlaces
duplicaría la fuente de verdad. Corregir código excedería esta autorización.

## Seguridad y compatibilidad
Las reproducciones transpilan fuentes locales y simulan dependencias: no ejecutan
sesiones reales, SQL ni solicitudes externas. No se instala ni actualiza nada.
La revisión estática no certifica RLS, ACL, configuración remota o carga real.

## Reversión
Revertir únicamente los archivos y enlaces de este cambio. No hay reversión de
datos ni impacto runtime. No archivar antes de integrar en la rama objetivo.

## Evidencia
HEAD inicial: 37dcf7dcfb89d6289369b4c962423a02097b5293; árbol inicial limpio.
Inventario y salidas en reports/. La matriz documental enlaza fuentes inspeccionadas.

# Comparación y evidencia

## Decisión

Se conserva el enfoque por lección del mixto, con contexto del curso y requisitos
concretos. Se incorporan la recuperación, respaldo y deduplicación del flujo Web
a un motor compartido. La elección reduce divergencia de código; no demuestra
por sí sola una tasa superior de éxito del proveedor. Las políticas de consumo
y respaldo de Materiales no se convierten entre sí.

## Verificación local

- Suite de curaduría: validación URL/PDF y cobertura, pruebas de integración del
  worker y esquemas estrictos. Los últimos casos comparan ambos adaptadores sin
  documentos, cuota tres, arranque desde cero, reanudación desde 2/3, URLs
  rechazadas, aliases de redirección y guardas de revisión/currículo/intento.
  Resultado final: 18/18 de integración y 2/2 de esquemas, más los programas de
  validación y cobertura aprobados, código 0. Log .tmp/unified-curation-tests.log.
  Ambos adaptadores reprodujeron un conjunto sintético de 49/60 fuentes en veinte
  lecciones: conservaron las 49 y confirmaron solo las once faltantes buscando
  exclusivamente las cinco lecciones pendientes. No es una búsqueda real.
- Suite documental: 86/86 aprobadas; conserva DOCUMENTS_ONLY sin cliente web,
  conjuntos completos sin nueva búsqueda, cancelación sin filas/aprobación y
  documentos previos. Log .tmp/unified-source-tests.log.
- Tipos: npm run typecheck, código 0.
- ESLint dirigido de los siete archivos de código/pruebas: --max-warnings 0,
  código 0. OpenSpec estricto y git diff --check aprobados.

Durante la adaptación, una importación de pruebas cruzó rootDir. Se sustituyó por
el cargador de fuentes existente y se retiraron únicamente los seis JS emitidos
por ese intento. No se amplió rootDir ni se cambiaron exclusiones de TypeScript.
La comparación de arrays entre contextos VM se normalizó con Array.from y se
movieron las aserciones fuera de las funciones simuladas de búsqueda para que el
motor no interpretara un fallo del test como fallo del proveedor. La cancelación
comprueba los tres checkpoints vacíos nuevos y ausencia de aprobación.

## Revisión adversarial del mismo agente

- No cambia autenticación, autorización, organización, firma ni RPCs existentes.
- El motor no crea autoridad de escritura: cada fuente pasa por su checkpoint.
  Solo se cuenta después de confirmarla; cancelación/sustitución impiden cierre.
- Las URLs conservan SSRF, HTTP, MIME, contenido, paywall y redirecciones del
  validador existente. El mixto conserva además la elegibilidad de evidencia para
  su siguiente lectura. No se recorta la cuota ni se cuentan aliases como fuentes.
- Contexto y telemetría se comparten, pero los diagnósticos nuevos no incluyen
  respuestas, consultas ni textos privados. El error técnico de una lección no
  impide guardar progreso de otra; errores permanentes de proveedor detienen
  llamadas inútiles.
- No hay migraciones, dependencias nuevas, generaciones pagadas, commits,
  push ni despliegues. No se ejecutó verify:pr completo ni el piloto remoto.

## Piloto pendiente

1. Tras desplegar la entrega autorizada, reanudar el curso existente conservando
   sus 49 fuentes y su política. Verificar que solo se buscan las cinco lecciones
   pendientes y que no cambian IDs ni fuentes completas.
2. Comparar dos borradores equivalentes en Web y mixto sin archivos: mismo plan,
   cuota, modelo principal/respaldo, prompts y despliegue; comenzar con la misma
   cobertura. No cambiar política a mitad de una ejecución.
3. Medir cobertura, fuentes nuevas, rechazos/duplicados, errores por lección,
   solicitudes, duración y uso/coste del proveedor. Un motor por lección puede
   requerir más solicitudes que los lotes anteriores; el beneficio real de
   calidad/tiempo debe medirse y el deadline puede exigir reanudar cursos largos.
4. Conservar el conjunto de fuentes válidas y diagnosticar faltantes. Completar
   la cuota no acredita respaldo semántico de los materiales generados.

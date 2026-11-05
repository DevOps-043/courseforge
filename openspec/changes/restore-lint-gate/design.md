# Diseño y contexto

El baseline final usa schemaVersion 2: archivo → regla → SHA256 de la línea de
código sin indentación → cantidad. No guarda código ni rutas absolutas. Distingue
sustituciones aunque el conteo sea igual y tolera desplazamientos de línea. La
comparación de reportes local y limpio confirma huellas idénticas en Node24/22.

La verificación fría con Node 22 y dependencias aisladas agota el heap automático
de aproximadamente 2 GiB (exit 134). El comando root typecheck fija 4 GiB, igual
que la política existente del build Netlify, sin modificar tsconfig ni excluir
fuentes. Reintento y OOM se registran por separado; no se extrapola capacidad
operativa ni se aumenta el heap de todos los procesos del sistema.

Actor: ingeniería. Objetivo: ejecutar lint y mantener visibles las infracciones
sin permitir nuevas deudas cubiertas por el baseline. Base: 9362ae1c, staging.
Se preservan cambios heredados y no se reinstala sobre el checkout principal.
Se aplican enrich-requirement, verify-change y revisión adversarial propia.

El preset instalado registra react-hooks y react en una entrada limitada por
files; la configuración local usa sus reglas en un objeto sin files. Registrar
los mismos objetos plugin en un bloque global evita redefiniciones y mantiene
reglas/configuración del proveedor. No actualizar versiones ni cambiar niveles.

Los errores siguen bloqueando. Los warnings se inventarían por archivo/regla;
el gate debe rechazar un canario nuevo aun cuando su severidad sea warning.
No normalizar ni añadir baseline a ciegas: conservar reporte completo y revisión.
Instalación limpia se prepara en una carpeta descartable, nunca en el árbol de
dependencias existente. CI Node 22 y ejecución local Node 24 se distinguen.

No objetivos: corregir ciclos, reescribir UI, certificar build o servicios reales.
Reversión por commit; preservar gate y evidencia, sin restaurar tolerancia muda.

La ejecución completa tras registrar plugins distingue 1.646 errores de salidas
compiladas (dist y .tmp anidados, sin archivos versionados) y siete require en el
script QA de subtítulos manuales. ESLint excluye esos artefactos generados igual
que tsconfig, manteniendo fuentes y tools; los canarios prueban ambas categorías.
El script QA conserva nombre, contenido del fixture y flujo: carga dependencias
con import dinámico dentro de main, sin apagar no-require-imports.

El baseline versionado cuenta warnings por archivo/regla, no errores. Disminuir
warnings obliga a bajar su conteo; eliminarlos de un archivo no habilita agregarlos
en otro. El reporte completo se conserva en apps/web/.tmp/lint/latest.json. No hay
modo automático del gate para aceptar una nueva línea base.

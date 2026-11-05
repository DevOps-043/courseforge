# Diseño

La primera ejecución después de corregir resolución alcanza una aserción del
compilador que espera SofLIA - Engine. El productor usa APP_CONFIG.name y la
fuente canónica de branding confirma SofLIA Architect para contenido nuevo.
Se sustituye el regex ligado a la marca antigua por la comprobación del atributo
JSON decodificado completo (default, id, label y type), del elemento html y sus
atributos de idioma/runtime. La prueba mantiene los asserts de data-var-src y
ausencia de src remoto persistido. No se cambia branding ni el productor.

Base 3ce00036, staging. Se preservan cambios heredados y no se crean worktrees.
La unidad de medios reprodujo el fallo sobre fuentes del adaptador sin cambios.
La dependencia @/lib/server/outbound-http apunta al mismo archivo que
../../../lib/server/outbound-http desde composition-editor. TypeScript/Next
resuelven ambas referencias; la relativa también es ejecutable en el árbol
CommonJS emitido bajo .tmp/hyperframes-tests sin registrar un loader global.

La prueba existente importa el adaptador para construir y validar requests de
modelos sin invocar proveedores. Su fallo de carga es el canario de regresión.
Se conservan el lector de respuesta limitado y toda lógica del proveedor.
No actualizar paquetes ni mockear el transporte para evitar el fallo.

Verificar suite existente, tipos, lint y gate. No acreditar CI/build, RLS,
servicios reales ni la matriz completa de F3.4 por esta corrección. Reversión
por commit local; sin efectos remotos ni datos que revertir.

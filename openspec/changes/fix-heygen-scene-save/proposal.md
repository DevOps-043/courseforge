# Guardado de escenas observable y compatible con borradores

Se reporta que «Guardar cambios» no funciona, sin detalle de respuesta o error.
La captura acredita el control visible, no su resultado. La inspección detectó
dos problemas reproducibles: los clips manuales nacen con guion vacío y el
schema de guardado los rechaza; la confirmación usa toast sin Toaster montado
en la aplicación. Además no se muestra estado pendiente ni se bloquean dobles
guardados.

También se detectó que eliminar un clip manual lo omitía del snapshot, mientras
el RPC conserva escenas ausentes para proteger escrituras concurrentes. Se
enviará deleted=true, igual que con las escenas de storyboard, para que no reaparezca.

Se permitirá persistir borradores, manteniendo validación estricta de estructura
y de guion antes de generar. El guardado tendrá feedback local accesible y
respuesta verificada. No se presupone que estos hallazgos sean el incidente
exacto de producción, ni se iniciará generación facturable para comprobarlos.

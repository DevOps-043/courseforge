# Selectores de modelos de sesiones

## Alcance

Agenda, plan sincrónico e híbrido y materiales de sesión reutilizan PremiumSelect.
El catálogo de modelos de texto se extrae de CurationSettingsManager a
shared/ai/text-model-options.ts, conservando sus opciones. El catálogo de imagen
sigue separado. No se cambian actions, permisos, validadores ni snapshots de runs.

Se conserva la herencia; sus selectores quedan deshabilitados. Un valor existente
fuera del catálogo aparece como configurado. El respaldo puede retirarse con
Sin respaldo; seleccionar como principal el respaldo actual lo limpia y la lista
de respaldo excluye el principal. El servidor conserva su validación independiente.

## Evidencia y límites

- Bundle local del componente real con acciones simuladas: compiló con esbuild.
- OpenSpec: validación estricta de unify-workshop-authoring-form aprobada.
- git diff --check: aprobado, con avisos de conversión LF/CRLF.
- ESLint dirigido: cero errores y dos advertencias set-state-in-effect en efectos
  existentes de DeliverySettingsPanel y CurationSettingsManager. --max-warnings 0
  terminó sin aprobar; no se deshabilitó ninguna regla ni se amplió el baseline.
  La ejecución de ESLint sobre ambos originales de HEAD confirmó una advertencia
  de la misma regla por archivo, sin errores.
- Revisión visual pendiente: Chrome no pudo cargar el servidor local de prueba
  por 127.0.0.1 ni localhost (ERR_CONNECTION_TIMED_OUT). No se verificó interacción
  ni guardado real; no se generó contenido pagado ni se modificó staging.
- npm run typecheck: aprobado (código 0). El primer intento se interrumpió tras
  quedar sin resultado; la ejecución posterior desde cmd.exe finalizó correctamente.

No se realizó commit, push ni despliegue. Este cambio permite elegir modelos;
no resuelve por sí mismo INVALID_OUTPUT ni UNSUPPORTED_OUTPUT.

# Contexto y diseño

- Actor: autor del video; objetivo: escribir y temporizar subtítulos manualmente.
- Base: NATIVE_CAPTIONS, origin MANUAL, clip.add y clip.caption-cues existentes.
- Alcance: descubrimiento y flujo manual de creación/edición; ninguna solicitud
  de transcripción ni generación se dispara por abrir la pestaña o crear una capa.
- UI: pestaña Subtítulos; acción manual primaria y generación opcional separada.
- El primer subtítulo dura hasta dos segundos dentro de la duración vigente de
  capa; una capa de cinco segundos deja sitio para nuevas frases. No se reescribe
  ningún subtítulo existente.
- Tras persistir, el editor selecciona la capa, abre Propiedades y coloca el
  cursor en su inicio para que pueda verse durante la edición.
- El guardado sigue usando esquemas, cola, hash y autorización existentes. No se
  añade autoridad al cliente ni se cambian permisos por organización.
- QA: crear sin voz, escribir dos frases y sus tiempos, guardar, recargar el
  documento simulado, bloquear pista y comprobar que generación no fue llamada.
- Límites: almacenamiento remoto y render cloud se prueban aparte; el flujo local
  usa componentes, factory y reducer reales con persistencia simulada.
- Reversión: retirar el nuevo acceso y restaurar defaults; los documentos MANUAL
  siguen siendo compatibles, sin migración.

# Contexto

- Objetivo y actor: el arquitecto entrega un taller híbrido; un administrador de
  Academy revisa y aprueba; instructor y alumnos acceden por permisos de Academy.
- Base y alcance: checkouts courseforge y SofLIA-Learning; preservar los cambios
  locales de fechas en Academy. Fuente normativa: prompt_maestro de Hub, alias
  del estándar de ingeniería. La guía del dominio confirma el bloqueo actual.
- No objetivos: generar videos pagados, inventar fechas, cambiar roles, reparar
  el navegador integrado, publicar o migrar bases compartidas durante pruebas.
- Contratos: publicación v2, outbox/inbox, revisión administrativa, identidad
  externa estable, currículo/recorrido, preparación de sesión y confirmación.
- Permisos: emisor y receptor autorizan organización y actor en servidor; la
  organización declarada en JSON no concede acceso. Notas y respuestas privadas
  no se incluyen en la proyección del alumno.
- Criterios: identidades estables al reordenar, reintentos sin duplicados,
  rechazo previo a escrituras, aprobación atómica, v1 compatible y activación
  solo después de demostrar recepción y autorización con PostgreSQL aislado.
- Incertidumbres: migraciones aplicadas, identidad organizacional compartida,
  aprobación y programación de sesiones reales requieren validación del entorno.

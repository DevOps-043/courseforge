# Seguridad y tenancy

Estado: vigente. Actualizado: 2026-10-15.

- Resolver usuario y organización activa en servidor; no aceptar ownership del payload.
- Mantener Auth Bridge, profiles, roles y organización en cada frontera de datos.
- Los logs de indisponibilidad de autoridad son best-effort: un fallo síncrono de
  observabilidad no debe sustituir la clase conocida ni habilitar un fallback.
- Acceso service-role necesita autorización explícita por recurso; no sustituye RLS.
- No exponer credenciales privadas mediante NEXT_PUBLIC_*, logs o artefactos.
- URLs, ZIP SCORM, imports y bundles requieren validadores del dominio y límites.
- Publicación, envíos, despliegues y SQL remoto requieren autorización humana.
- Registrar efectos inciertos y evitar reintentos que dupliquen publicaciones.
- Migraciones locales: npm run db:migrations:check. No aplica SQL ni prueba RLS remoto.
- Ver [política de herramientas](../../ai-specs/policies/tool-boundaries.md).

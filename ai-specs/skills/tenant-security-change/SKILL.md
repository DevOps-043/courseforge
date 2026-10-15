---
name: tenant-security-change
description: Revisa aislamiento por organización, Auth Bridge y persistencia con mínimo privilegio.
---

# tenant-security-change

1. Leer docs/standards/security-and-tenancy.md y resolver propietario/organización en servidor.
2. Revisar Auth Bridge, profiles, membresía y ownership por recurso.
3. Identificar uso de service-role y demostrar controles anteriores a cada acceso privilegiado.
4. Para migraciones, documentar RLS, índices, idempotencia, compatibilidad y rollback.
5. Ejecutar npm run db:migrations:check y pruebas locales de permisos relevantes.
6. No ejecutar SQL remoto ni mutaciones destructivas sin autorización explícita.

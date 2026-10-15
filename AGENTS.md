# Coursegen / Courseforge — entrada para agentes

Este archivo es el router de desarrollo de SofLIA Engine. Las reglas canónicas
viven en docs/ y ai-specs/; los cambios durables, en openspec/.

## Lectura obligatoria

1. [Estándares base](docs/standards/base.md) y [estándar de ingeniería](docs/standards/engineering-practices.md).
2. [Contexto real del sistema](docs/architecture/system-context.md).
3. Guía del área: [web y jobs](docs/standards/web-and-jobs.md),
   [seguridad y tenancy](docs/standards/security-and-tenancy.md),
   [pruebas](docs/standards/testing.md), [documentación](docs/standards/documentation.md).
4. El cambio correspondiente en openspec/changes/ y su evidencia.
5. La skill pertinente bajo ai-specs/skills/.
6. Para producción multimedia: [flujo HyperFrames](docs/architecture/hyperframes-composition-render-flow-source-of-truth.md)
   y [ADR de motion](docs/architecture/adr-composition-motion-source-of-truth.md).

## Invariantes

- Mantener español en instrucciones, documentación, UI y logs nuevos.
- Preservar trabajo ajeno y aislar cambios materiales con rama/worktree recuperable.
- No inventar tablas, contratos, capacidades, credenciales ni resultados de pruebas.
- Mantener UI, rutas HTTP, servicios de dominio y acceso a datos separados.
- Validar identidad, rol y organización en servidor; el payload no concede autoridad.
- No leer ni modificar secretos, .env o configuraciones locales de otra persona.
- Publicación, despliegue, envíos y operaciones destructivas requieren autorización.
- Las skills de desarrollo no son herramientas de Lia ni del bundle-agent runtime.
- Actualizar especificación, documentación y evidencia junto con el cambio.
- Archivar OpenSpec después de integrar en la rama objetivo.

## Comandos de verificación

```powershell
npm run adapters:check
npm run harness:validate
npm run docs:check
npm run openspec:validate
npm run test:harness
npm run verify:pr
```

verify:pr incluye la verificación de producto existente. Las pruebas del dominio
se seleccionan con docs/standards/testing.md; las QA visuales y el build siguen en CI.
La [guía operativa](docs/operations/harness-quickstart.md) explica el ciclo.

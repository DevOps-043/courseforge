# Plan: Sandbox Seguro Para Plantillas Remotion Externas

## Objetivo

Permitir que Courseforge acepte ZIPs de plantillas Remotion externas sin ejecutar codigo arbitrario en el worker actual. La V1 se limita a subir, validar, auditar y aprobar o rechazar bundles. El render final sigue usando composiciones internas hasta que exista una fase posterior de compilacion/render con aislamiento fuerte.

## Principios

- Seguridad primero: ningun ZIP se ejecuta, compila ni instala dependencias en V1.
- Contratos explicitos: cada bundle debe incluir `courseforge-remotion-template.json`.
- Trazabilidad: cada version de bundle se registra con estado, hash, reporte y aprobador.
- Separacion de responsabilidades: validacion, persistencia, acciones admin y render se mantienen desacoplados.
- Compatibilidad: presets internos y flujo no tecnico permanecen como camino principal.

## Modelo

Los ZIPs externos se modelan como versiones auditables en `remotion_template_versions`, vinculadas a `remotion_templates`.

Estados:

- `UPLOADED`
- `VALIDATING`
- `VALIDATION_FAILED`
- `PENDING_REVIEW`
- `APPROVED`
- `REJECTED`
- `DEPRECATED`

Campos clave:

- `storage_path`
- `bundle_hash`
- `entry_point`
- `manifest`
- `validation_report`
- `validated_at`
- `approved_at`
- `approved_by`
- `rejected_at`
- `rejected_by`
- `rejection_reason`

## Manifest Requerido

Cada ZIP debe incluir un archivo raiz:

```json
{
  "name": "Corporate Intro",
  "entryPoint": "src/index.tsx",
  "compositionId": "main",
  "remotionVersion": "4.x",
  "propsSchemaVersion": 1
}
```

## Validaciones V1

- Tamano maximo del ZIP.
- Numero maximo de archivos.
- Rechazo de path traversal, rutas absolutas y symlinks.
- Manifest obligatorio y JSON valido.
- `entryPoint` relativo, permitido y existente.
- Extensiones permitidas.
- Dependencias permitidas si existe `package.json`.
- Calculo de hash deterministico.
- Reporte estructurado sin secretos ni stack traces sensibles.

## No Objetivos V1

- No ejecutar codigo externo.
- No compilar bundles externos.
- No instalar dependencias.
- No permitir red desde bundles.
- No cambiar el worker de render para usar bundles externos.

## Fase Posterior

La Fase 2 debera introducir un runner aislado, idealmente contenedorizado, con limites de CPU, memoria, tiempo, red y variables de entorno minimas. Solo bundles `APPROVED` podran pasar a compilacion/render externo.


# Protocolo de investigacion y sincronizacion documental

## Regla de activacion

**Al abrir o usar este documento, ejecutar este protocolo completo antes de dar por vigente `README.md` o `CLAUDE.md`.** La lectura humana por si sola no puede modificar archivos; la actualizacion ocurre al ejecutar los pasos y aplicar los cambios sustentados que resulten. No se deben inventar capacidades ni completar huecos con supuestos.

Documentos de salida obligatorios:

- `README.md`: que es el producto, arquitectura, dominios, flujos, rutas y como validarlo.
- `CLAUDE.md`: contexto operativo para agentes, arquitectura vigente, comandos, reglas y dependencias.
- `docs/documentation-audit.md`: evidencia temporal de la auditoria actual. Se regenera y no reemplaza a las dos fuentes de verdad.

## Ejecucion rapida

Desde la raiz del repositorio:

```powershell
npm run docs:audit
```

Para revisar desde una referencia concreta:

```powershell
./scripts/audit-documentation.ps1 -BaseRef origin/main
```

El informe enumera cambios Git, migraciones, rutas API, funciones background, variables declaradas y archivos de alto impacto. Es evidencia inicial: hay que abrir los archivos relevantes antes de documentar su comportamiento.

## Procedimiento obligatorio

1. **Fijar alcance.** Anotar `HEAD`, base comparada, fecha, entorno y si hay cambios sin commit (`git status --short`). No mezclar cambios ajenos sin indicarlo.
2. **Recolectar evidencia.** Ejecutar la auditoria y revisar el diff (`git diff --name-status <base>...HEAD`). Inspeccionar los archivos modificados y sus pruebas. Para capacidades existentes sin cambios recientes, usar rutas, servicios, schemas, migraciones y tests como evidencia primaria.
3. **Clasificar cada hallazgo.** Etiquetarlo como `agregado`, `modificado`, `eliminado`, `legacy`, `documentacion desactualizada` o `requiere decision`. Marcar el nivel: producto, arquitectura, API/job, datos, cloud/credenciales, seguridad u operacion.
4. **Contrastar.** Buscar la afirmacion correspondiente en `README.md` y `CLAUDE.md`. Registrar si coincide, falta, contradice o esta obsoleta. El codigo y las migraciones vigentes prevalecen; el historial Git aporta contexto, no reemplaza la verificacion actual.
5. **Actualizar las fuentes de verdad.** Editar ambos documentos cuando el hallazgo cambie su alcance. Mantener enlaces entre ellos, quitar afirmaciones invalidadas y conservar la distincion entre flujo activo y legacy. Para secretos, documentar solo nombres, propietario y procedimiento; nunca valores.
6. **Validar.** Confirmar que rutas, jobs, tablas, variables y comandos escritos existen. Ejecutar la prueba o build proporcional al cambio. Revisar `git diff --check` y la diferencia final de los tres documentos.
7. **Cerrar con trazabilidad.** Actualizar `docs/documentation-audit.md` con el resultado, evidencia y pendientes. Si no hay cambios, registrarlo expresamente: no alterar `README.md` ni `cloud.md` solo para cambiar fecha.

## Matriz de contraste

| Evidencia encontrada | Debe revisarse en `README.md` | Debe revisarse en `CLAUDE.md` |
| --- | --- | --- |
| Dominio, UI o flujo de usuario | Arquitectura y flujo correspondiente | Contexto operativo y patrones de implementacion |
| API route, Netlify Function o worker | APIs y Jobs | Comandos, operacion, readiness y reglas |
| Migracion, tabla, bucket o RLS | Datos y Storage | Patrones de seguridad y tenancy |
| Variable de entorno, OAuth o proveedor | Variables de entorno | Dependencias, variables y restricciones operativas |
| Render, preview, template o proveedor de video | Produccion visual | Proveedor activo, cloud/legacy y reglas de diagnostico |
| Eliminacion o deprecacion | Arquitectura/API y reglas de mantenimiento | Instrucciones activas y compatibilidad legacy |

## Criterios de aceptacion

- Cada afirmacion nueva referencia una ruta, migracion, prueba o configuración comprobable.
- `README.md` explica el producto sin exponer secretos; `CLAUDE.md` permite a los agentes trabajar con el estado y las reglas vigentes sin duplicar detalles narrativos.
- Ninguna ruta, job, tabla o variable documentada queda sin comprobar cuando el alcance la incluye.
- Las capacidades legacy estan marcadas como tales y no se presentan como ruta predeterminada.
- La auditoria deja pendientes y decisiones abiertas visibles; no los oculta con lenguaje ambiguo.

## Prompt operativo para agentes

> Lee `docs/PROTOCOLO_DE_INVESTIGACION_Y_SINCRONIZACION.md`, ejecuta `npm run docs:audit`, contrasta los hallazgos con `README.md` y `CLAUDE.md`, revisa la evidencia primaria y actualiza ambos documentos solo con hechos verificables. Entrega el diff, las validaciones y los pendientes.

# Protocolo de actualización y cumplimiento: HeyGen y HyperFrames

Estado: activo desde 2026-08-25  
Dueños: Engineering, Security/DevOps, Product y Legal/Compliance.

## Propósito

Evitar que una actualización de HyperFrames, sus dependencias o la integración
de HeyGen llegue a producción sin licencia, avisos, plan, seguridad de claves o
evidencia de consentimiento revisados.

Este protocolo complementa, y no sustituye, el proceso documental de
`docs/PROTOCOLO_DE_INVESTIGACION_Y_SINCRONIZACION.md`. El código y el lockfile
son evidencia primaria; los documentos no reemplazan su inspección.

## Cuándo se activa

Debe ejecutarse antes de fusionar un cambio que:

- agregue, elimine o actualice un paquete `@hyperframes/*` o cambie el
  `package-lock.json` que lo resuelve;
- copie, parchee, haga fork o distribuya código, ejemplo o plantilla de
  HyperFrames;
- cambie un build, Dockerfile, worker, instalador, SDK o bundle que se entregue
  fuera de la infraestructura de Courseforge;
- cambie rutas, credenciales, webhooks, avatares, voces, medios o el proveedor
  HeyGen/HyperFrames Cloud;
- anuncie un nuevo plan, cuenta, mercado, caso de uso comercial o región que
  use HeyGen;
- llegue a la revisión trimestral, aunque no haya cambios de código.

## Flujo de control

1. **Abrir ficha.** El autor anota PR, `HEAD`, componente, versión anterior y
   nueva, razón del cambio, organización/entorno y modo de entrega: SaaS,
   paquete, contenedor, on-premise o SDK.
2. **Inventariar.** Ejecutar `npm ls @hyperframes/studio @hyperframes/studio-server @hyperframes/core @hyperframes/parsers @hyperframes/player @hyperframes/sdk --workspace=apps/web --depth=1`; revisar `package-lock.json`, el paquete instalado y cualquier código copiado. Ejecutar `npm run compliance:verify` para regenerar el SBOM CycloneDX y validar el aviso y las versiones fijadas.
3. **Verificar derechos.** Guardar enlace o copia de la licencia y `NOTICE` de
   la versión exacta. Para Apache-2.0, determinar si hay redistribución; si la
   hay, incluir licencia y avisos. Si se modificó upstream, confirmar que cada
   archivo conserva avisos y declara el cambio.
4. **Verificar HeyGen.** Confirmar plan que permite el uso previsto, términos
   vigentes, propietario de cuenta, presupuesto/alertas, consentimiento y
   derechos de avatar, voz y medios. Confirmar que claves sólo existen en
   secretos server-side, que no se registran en logs y que el webhook valida
   firma y replay.
5. **Actualizar artefactos.** Actualizar, según aplique:
   `THIRD_PARTY_NOTICES.md`, `licenses/`, este registro, SBOM, `.env.example`
   (solamente nombres), documentación de despliegue y el paquete/contenedor que
   sale a usuarios.
6. **Validar.** Ejecutar pruebas proporcionales; comprobar `git diff --check`;
   inspeccionar el artefacto de producción para confirmar que contiene los
   avisos. Verificar que el frontend no contiene `HEYGEN_API_KEY`,
   `HYPERFRAMES_CLOUD_API_KEY` ni secretos por organización.
7. **Aprobar y cerrar.** El dueño técnico aprueba arquitectura; Security/DevOps
   aprueba secretos/entrega; Legal/Compliance aprueba cambios de licencia,
   plan o uso comercial. Registrar fecha, evidencia, aprobadores y excepciones
   en el PR o en el registro.

## Lista de salida obligatoria

- [ ] Versión y origen de cada componente afectados identificados.
- [ ] Licencia y `NOTICE` de la versión concreta revisados.
- [ ] Avisos y texto de licencia presentes en cada artefacto redistribuido.
- [ ] Código upstream modificado marcado y con sus avisos preservados, si
      existe.
- [ ] SBOM/lockfile y registro conciliados.
- [ ] Claves en backend/secret manager; sin secretos en diff, logs ni bundle.
- [ ] Webhook autenticado, con idempotencia y manejo de reintentos, si aplica.
- [ ] Plan de HeyGen y derechos/consentimientos confirmados para el uso.
- [ ] Pruebas y validación del artefacto ejecutadas.
- [ ] Aprobaciones y evidencia enlazadas al cambio.

## Revisión trimestral

Product/Legal revisa términos, política de uso y plan de HeyGen. Engineering
revisa versiones de HyperFrames, `NOTICE`, vulnerabilidades y el SBOM.
Security/DevOps revisa acceso, rotación de claves, logs y pruebas del webhook.
Las variaciones se registran aun cuando no impliquen cambios de código.

## Manejo de excepción

No se publica una excepción verbal. Debe documentar el riesgo, alcance,
justificación, dueño, fecha de caducidad y aprobación escrita de Legal y del
dueño técnico. Las excepciones vencidas bloquean la siguiente actualización o
release relacionado.

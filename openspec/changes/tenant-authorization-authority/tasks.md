# Tablero

| Unidad | Hallazgo | Responsable | Estado | HEAD base | Evidencia | Siguiente paso |
|---|---|---|---|---|---|---|
| F1.1 | TD-26 | Codex | cerrado | 37dcf7dc | reports/context-F1.1.md | F1.2: implementar resolver |
| F1.2 | TD-26 | Codex | cerrado | 37dcf7dc | reports/context-F1.2.md | F1.3: frontera privilegiada |
| F1.3 | TD-26 | Codex (tramo local) | en curso | 0927374c | reports/context-F1.3c1.md | Identidad y errores por rutas pendientes |
| F1.3.a | TD-26 | Codex | cerrado | 0927374c | reports/context-F1.3a.md | F1.3.b: accesos derivados |
| F1.3.b | TD-26 | Codex | cerrado | 16d59247 | reports/context-F1.3b.md | F1.3.c: identidad y errores HTTP |
| F1.3.c | TD-26 | Codex (tramo local) | en curso | 8a581b59 | reports/context-F1.3c1.md | F1.3.c.2 y F1.3.c.3 |
| F1.3.c.1 | TD-26 | Codex | cerrado | 8a581b59 | reports/context-F1.3c1.md | F1.3.c.2: identidad uniforme |
| F1.3.c.2 | TD-26 | por asignar | planificado | — | — | Identidad GoTrue/Auth Bridge y tokens de jobs |
| F1.3.c.3 | TD-26 | por asignar | planificado | — | — | Errores de autoridad 503 por flujo |

- [x] Contrastar emisores, lectores, roles, membresías y revocación.
- [x] Definir contrato seguro y compatibilidad legacy.
- [x] Ejecutar fixtures sobre fuentes actuales y acreditar rechazo de aceptación.
- [x] Ejecutar suites locales y registrar revisión/continuidad.
- [x] F1.2: implementar resolver y probar contrato sobre fuente modificada.
- [ ] F1.3: cerrar fallbacks y probar consumidores.
- [x] F1.3.a: acceso central a artefactos y permisos de revisión con autoridad vigente.
- [x] F1.3.b: accesos derivados y contratos por flujo (aceptación local; SQL/HTTP real pendientes).
- [ ] F1.3.c: compatibilidad de sesión y normalización de errores.
- [x] F1.3.c.1: switch con membresía/rol vigentes, exp conservada y 503 seguro.
- [ ] F1.3.c.2: identidad uniforme y tokens por proveedor.
- [ ] F1.3.c.3: normalización de errores en consumidores restantes.
- [ ] Acreditar permisos reales de escritura de roles, RLS y ambiente antes de cierre TD-26.

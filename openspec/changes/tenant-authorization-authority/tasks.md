# Tablero

| Unidad | Hallazgo | Responsable | Estado | HEAD base | Evidencia | Siguiente paso |
|---|---|---|---|---|---|---|
| F1.1 | TD-26 | Codex | cerrado | 37dcf7dc | reports/context-F1.1.md | F1.2: implementar resolver |
| F1.2 | TD-26 | Codex | cerrado | 37dcf7dc | reports/context-F1.2.md | F1.3: frontera privilegiada |
| F1.3 | TD-26 | Codex (tramo local) | en curso | 0927374c | reports/context-F1.3a.md | F1.3.b y F1.3.c pendientes |
| F1.3.a | TD-26 | Codex | cerrado | 0927374c | reports/context-F1.3a.md | F1.3.b: accesos derivados |
| F1.3.b | TD-26 | Codex | cerrado | 16d59247 | reports/context-F1.3b.md | F1.3.c: identidad y errores HTTP |
| F1.3.c | TD-26 | por asignar | planificado | — | — | Switch, identidad legacy y errores HTTP |

- [x] Contrastar emisores, lectores, roles, membresías y revocación.
- [x] Definir contrato seguro y compatibilidad legacy.
- [x] Ejecutar fixtures sobre fuentes actuales y acreditar rechazo de aceptación.
- [x] Ejecutar suites locales y registrar revisión/continuidad.
- [x] F1.2: implementar resolver y probar contrato sobre fuente modificada.
- [ ] F1.3: cerrar fallbacks y probar consumidores.
- [x] F1.3.a: acceso central a artefactos y permisos de revisión con autoridad vigente.
- [x] F1.3.b: accesos derivados y contratos por flujo (aceptación local; SQL/HTTP real pendientes).
- [ ] F1.3.c: compatibilidad de sesión y normalización de errores.
- [ ] Acreditar permisos reales de escritura de roles, RLS y ambiente antes de cierre TD-26.

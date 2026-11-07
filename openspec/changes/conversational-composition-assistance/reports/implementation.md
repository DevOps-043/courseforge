# Evidencia local

## Verificación

| Comando | Resultado |
| --- | --- |
| npm run test:hyperframes --workspace=apps/web | 698 pruebas aprobadas. Cubre el contrato de respuesta, el contexto, las operaciones nuevas, los bloqueos y la base exacta de la reversión. |
| npm run test:security-boundaries | 115 pruebas aprobadas. |
| npm run typecheck | Código 0. |
| ESLint sobre los archivos de la asistencia modificados | Código 0. |
| npm run openspec:validate | 52 elementos válidos. |
| npm run docs:check | Código 0. |
| git diff --check | Código 0. |
| npm run verify:pr | Código 1 en test:harness. Git recibió permiso denegado al escribir .git/config en los repositorios temporales de las pruebas. |

## Aceptación pendiente

Probar en el editor con un proveedor configurado y una composición con varias
pistas audibles. Enviar «Baja el volumen», responder a la aclaración con un
porcentaje y comprobar que recién entonces aparece la propuesta. Revisar
el diff, confirmar y deshacer. Repetir con un clip bloqueado y con una instrucción
fuera del catálogo. Las pruebas locales no ejecutaron el proveedor ni la UI
en navegador.

# Diseño

El runner parsea tsconfig con base absoluta y entrega a Madge { options },
evitando la reconversión de compilerOptions que pierde pathsBasePath. Conserva
apps/web/src, apps/web/netlify/functions y extensiones ts/tsx, incluido import type.
Se valida el resultado con fixtures reales del resolvedor instalado.

El runner no debe convertir todos los avisos en tolerancias. Los casos de CSS y
marcadores Next se clasifican solo si existen los recursos del bundler instalado.
Cualquier referencia nueva sin clasificación demostrable bloquea. El reporte
conserva specifiers, grafo, ciclos, versiones, hashes y resultado; no cuerpos de
fuentes, variables de entorno o credenciales.

Las pruebas deben demostrar que un alias acíclico resuelve, un ciclo por alias
falla, un ciclo solo de tipos también falla y un alias inexistente bloquea.
El comando público architecture:cycles conserva su posición en verify y los
canarios se integran en test:harness. Sin nuevos ignores de fuentes.

El runner admite --entry/--tsconfig juntos para diagnósticos acotados y --report
para separar artefactos. Permite probar el comando real con procesos hijos y
verificar sus códigos 0/1, además del analizador. Sin argumentos conserva las
dos entradas canónicas; el script del gate no añade opciones para reducirlas.

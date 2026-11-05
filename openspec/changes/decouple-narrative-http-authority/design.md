# Diseño

composition-narrative-http-authorization.contract.ts posee la unión existente,
sin agregar estados ni importar handlers. La ruta pública anterior reexporta el
tipo para mantener compatibilidad. Los consumidores internos usan import type
desde el contrato neutral. Ningún módulo recibe autoridad del payload por ello.

La comparación de transpileModule CommonJS antes/después debe producir los
mismos bytes para los cuatro módulos modificados, además de typecheck y tests
existentes. El grafo debe perder la componente narrativa sin excluir tipos.

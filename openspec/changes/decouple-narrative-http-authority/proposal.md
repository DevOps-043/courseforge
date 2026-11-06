# Desacoplar contrato de autoridad HTTP narrativa — F3.5.c

## Why
El handler genérico de comandos importa su tipo de autorización desde el
adaptador de voz, y ese adaptador llama al handler genérico. Es la componente
de dos módulos identificada en F0.3 y aún presente tras F3.5.b.

## What Changes
- Mover el tipo a un contrato neutral sin imports de implementación.
- Dirigir allí los consumidores internos y conservar el export público anterior.
- Verificar tipos, JavaScript emitido idéntico y suites existentes de narrativa.

## Impact
Solo dependencias de tipos. Sin cambios de estados de autoridad, decisiones,
códigos HTTP, errores, límites, timeouts, rate limit, repositorios, SQL o RLS.

---
name: using-git-worktrees
description: Aísla cambios materiales y preserva el trabajo existente.
---

# using-git-worktrees

1. Inspeccionar rama, status y worktrees; no limpiar ni resetear trabajo ajeno.
2. Trabajar en el checkout principal; crear una rama solo cuando el alcance lo requiera y el usuario no lo haya restringido.
3. No crear ni reabrir worktrees salvo solicitud explícita del usuario. Ante trabajo concurrente o un checkout sucio, preservar los cambios mediante commits o respaldos recuperables sin sobrescribirlos.
4. Verificar ruta absoluta y registrar la base; no copiar .env ni credenciales.
5. Instalar desde lockfile cuando sea necesario, documentando excepciones de entorno.
6. Mantener commits pequeños; retirar un worktree solo tras preservar todo su trabajo.

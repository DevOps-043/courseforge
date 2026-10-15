---
name: using-git-worktrees
description: Aísla cambios materiales y preserva el trabajo existente.
---

# using-git-worktrees

1. Inspeccionar rama, status y worktrees; no limpiar ni resetear trabajo ajeno.
2. Crear rama codex/<tema> desde la base acordada.
3. Para trabajo concurrente o un checkout sucio, crear worktree aislado.
4. Verificar ruta absoluta y registrar la base; no copiar .env ni credenciales.
5. Instalar desde lockfile cuando sea necesario, documentando excepciones de entorno.
6. Mantener commits pequeños; retirar un worktree solo tras preservar todo su trabajo.

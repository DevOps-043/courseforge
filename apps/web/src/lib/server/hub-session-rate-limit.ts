const attempts = new Map<string, { count: number; reset: number }>();
/** Defensa local; el despliegue puede agregar límites compartidos en su edge. */
export function allowHubSessionConnection(userId: string, now = Date.now()): boolean {
  for (const [key, value] of attempts) if (value.reset <= now) attempts.delete(key);
  const current = attempts.get(userId);
  if (current) { current.count += 1; return current.count <= 20; }
  if (attempts.size >= 1000) return false;
  attempts.set(userId, { count: 1, reset: now + 60000 });
  return true;
}

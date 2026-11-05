/** Componentes fuertemente conexas, sin ejecutar los módulos del grafo. */
export function cyclicComponents(graph) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const active = new Set();
  const components = [];
  const visit = (consumer) => {
    indices.set(consumer, nextIndex);
    lowLinks.set(consumer, nextIndex);
    nextIndex += 1;
    stack.push(consumer);
    active.add(consumer);
    for (const target of graph[consumer] ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(consumer, Math.min(lowLinks.get(consumer), lowLinks.get(target)));
      } else if (active.has(target)) {
        lowLinks.set(consumer, Math.min(lowLinks.get(consumer), indices.get(target)));
      }
    }
    if (lowLinks.get(consumer) !== indices.get(consumer)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      active.delete(member);
      component.push(member);
    } while (member !== consumer);
    if (component.length > 1 || graph[consumer]?.includes(consumer)) components.push(component.sort());
  };
  for (const consumer of Object.keys(graph)) if (!indices.has(consumer)) visit(consumer);
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

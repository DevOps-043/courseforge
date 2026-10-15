import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

export const targets = ['.codex', '.claude', '.agents'];
export const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function inside(root, path) {
  const full = resolve(root, path);
  const rel = relative(resolve(root), full);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Ruta fuera del repositorio: ' + path);
  let cursor = resolve(root);
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error('Enlace no permitido en el arnés: ' + path);
  }
  return full;
}
export function readSkills(root) {
  const source = inside(root, 'ai-specs/skills');
  const skills = [];
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Skill enlazada no permitida: ' + entry.name);
    if (!entry.isDirectory()) continue;
    if (!slug.test(entry.name)) throw new Error('Nombre de skill inválido: ' + entry.name);
    const file = inside(root, 'ai-specs/skills/' + entry.name + '/SKILL.md');
    const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    const match = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(text);
    if (!match || match[1].trim() !== entry.name || !match[2].trim()) throw new Error('Metadatos de skill inválidos: ' + entry.name);
    skills.push({ name: entry.name, description: match[2].trim() });
  }
  if (!skills.length) throw new Error('No hay skills canónicas.');
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
export function wrapper(skill) {
  return '---\nname: ' + skill.name + '\ndescription: ' + skill.description +
    '\n---\n\n# Adaptador canónico\n\nLee completamente ../../../ai-specs/skills/' + skill.name +
    '/SKILL.md y sigue esa fuente. No mantengas instrucciones duplicadas aquí.\n';
}

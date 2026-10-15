import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { inside, readSkills, targets, wrapper } from './harness-lib.mjs';

try {
  const root = process.cwd();
  const check = process.argv.includes('--check');
  const skills = readSkills(root);
  const names = new Set(skills.map(skill => skill.name));
  const errors = [];
  for (const target of targets) {
    const dir = inside(root, target + '/skills');
    if (existsSync(dir)) for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Adaptador enlazado no permitido: ' + target + '/' + entry.name);
      if (entry.isDirectory() && !names.has(entry.name)) errors.push('Adaptador huérfano: ' + target + '/skills/' + entry.name);
    }
  }
  // No escribir nada si hay un wrapper sin fuente: puede contener trabajo ajeno.
  if (errors.length) throw new Error(errors.join('\n'));
  for (const target of targets) for (const skill of skills) {
    const path = target + '/skills/' + skill.name + '/SKILL.md';
    const full = inside(root, path);
    const expected = wrapper(skill);
    if (check) {
      if (!existsSync(full) || readFileSync(full, 'utf8').replaceAll('\r\n', '\n') !== expected) errors.push('Adaptador desactualizado: ' + path);
    } else {
      mkdirSync(inside(root, target + '/skills/' + skill.name), { recursive: true });
      writeFileSync(full, expected, 'utf8');
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Adaptadores ' + (check ? 'verificados' : 'sincronizados') + ': ' + skills.length * targets.length);
} catch (error) {
  console.error('Adaptadores: ' + error.message);
  process.exitCode = 1;
}

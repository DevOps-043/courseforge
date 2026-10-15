// Authored local synthetic process-tree fixture. Never loads HTML, SDK, media or credentials.
import {spawn} from "node:child_process";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
const [role, directory, ...argumentsToCheck] = process.argv.slice(2);
if (!['root', 'child', 'grandchild', 'arguments', 'cpu', 'memory', 'count'].includes(role)) throw new Error('FIXTURE_ROLE_INVALID');
if (role === 'arguments') {
  writeFileSync(join(directory, 'arguments.json'), JSON.stringify({arguments: argumentsToCheck,
    hasSecret: Object.hasOwn(process.env, 'CAP027_TEST_SECRET')}), {flag: 'wx'});
  process.stdout.write('synthetic-owned-child-output\n');
} else if (role === 'cpu') {
  while (true) Math.sqrt(Math.random());
} else if (role === 'memory') {
  writeFileSync(join(directory, 'memory-start.json'), JSON.stringify({pid: process.pid}), {flag: 'wx'});
  const allocations = [];
  while (true) allocations.push(Buffer.alloc(16 * 1024 * 1024, 1));
} else if (role === 'count') {
  writeFileSync(join(directory, 'count-start.json'), JSON.stringify({pid: process.pid}), {flag: 'wx'});
  for (let index = 0; index < 10; index++) spawn(process.execPath, [fileURLToPath(import.meta.url), 'cpu', directory],
    {env: process.env, stdio: 'ignore', windowsHide: true}).on('error', () => {});
  setTimeout(() => process.exit(0), 1000);
} else {
  writeFileSync(join(directory, `${role}.json`), JSON.stringify({pid: process.pid}), {flag: 'wx'});
  if (role !== 'grandchild') spawn(process.execPath, [fileURLToPath(import.meta.url), role === 'root' ? 'child' : 'grandchild', directory],
    {env: process.env, stdio: 'ignore', windowsHide: true});
  setInterval(() => {}, 1000);
  if (role === 'root') setTimeout(() => process.exit(0), 2500);
}

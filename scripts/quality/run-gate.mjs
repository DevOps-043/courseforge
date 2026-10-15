import { spawnSync } from 'node:child_process';
import { gateScripts, executeGate } from './gate-plan.mjs';

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Ejecuta esta compuerta mediante npm run verify:harness o npm run verify:pr.');
  process.exitCode = 1;
} else {
  const status = executeGate(gateScripts(process.argv.includes('--harness-only')), script => {
    console.log('Compuerta: npm run ' + script);
    const result = spawnSync(process.execPath, [npmCli, 'run', script], { cwd: process.cwd(), stdio: 'inherit', shell: false });
    if (result.error) console.error('No se pudo ejecutar el paso: ' + result.error.message);
    return result.status ?? 1;
  });
  process.exitCode = status;
  if (!status) console.log('Compuerta completada.');
}

export function gateScripts(harnessOnly = false) {
  const harness = ['adapters:check', 'harness:validate', 'docs:check', 'openspec:validate', 'test:harness'];
  return harnessOnly ? harness : [...harness, 'verify'];
}
export function executeGate(scripts, execute) {
  for (const script of scripts) {
    const status = execute(script);
    if (status !== 0) return status ?? 1;
  }
  return 0;
}

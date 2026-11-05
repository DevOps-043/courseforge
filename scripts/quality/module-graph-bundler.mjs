import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const isFile = (file) => statSync(file).isFile();

/** Solo clasifica recursos que el bundler instalado realmente proporciona. */
export function classifyBundlerReference(specifier, projectRoot) {
  if (!['tailwindcss', 'server-only'].includes(specifier)) return null;
  const require = createRequire(path.join(path.resolve(projectRoot), 'package.json'));
  try {
    if (specifier === 'tailwindcss') {
      const manifestPath = require.resolve('tailwindcss/package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const style = manifest.exports?.['.']?.style;
      if (typeof style !== 'string' || !style.endsWith('.css')) return null;
      const packageRoot = path.dirname(manifestPath);
      const resource = path.resolve(packageRoot, style);
      if (!resource.startsWith(packageRoot + path.sep) || !isFile(resource)) return null;
      return { specifier, reason: 'Entrada CSS declarada en exports.style de Tailwind', resources: [resource] };
    }
    const { createServerOnlyClientOnlyAliases } = require('next/dist/build/create-compiler-aliases');
    if (typeof createServerOnlyClientOnlyAliases !== 'function') return null;
    const resources = [true, false].map((isServer) => {
      const alias = createServerOnlyClientOnlyAliases(isServer)['server-only$'];
      if (typeof alias !== 'string') throw new Error('Alias de Next ausente');
      return require.resolve(alias);
    });
    if (!resources.every(isFile)) return null;
    return { specifier, reason: 'Marcador de servidor con alias de Next comprobados para servidor y cliente', resources };
  } catch {
    return null;
  }
}

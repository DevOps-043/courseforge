import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifestPath = new URL('../apps/web/src/lib/server/background-deployment.generated.json', import.meta.url);

export function captureBackgroundDeployment(environment, destination = manifestPath) {
  let origin = null;
  if (environment.NETLIFY === 'true') {
    if (!environment.DEPLOY_URL) throw new Error('Falta DEPLOY_URL durante el build de Netlify.');
    const url = new URL(environment.DEPLOY_URL);
    if (url.protocol !== 'https:' || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('DEPLOY_URL debe ser un origen HTTPS sin credenciales, ruta ni parámetros.');
    }
    origin = url.origin;
  }
  // Solo metadatos públicos: nunca serializar process.env ni credenciales.
  writeFileSync(destination, `${JSON.stringify({ origin }, null, 2)}\n`, 'utf8');
  return { origin };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  captureBackgroundDeployment(process.env);
}

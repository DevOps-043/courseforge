import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const LAMBDA_ENVIRONMENT_LIMIT_BYTES = 4096;

/** Counts UTF-8 key/value bytes, not .env comments, whitespace or JSON overhead. */
export function measureEnvironment(environment, keys = Object.keys(environment)) {
  const entries = [...new Set(keys)].flatMap(key => {
    const value = environment[key];
    if (typeof value !== 'string') return [];
    return [{key, keyBytes: Buffer.byteLength(key), valueBytes: Buffer.byteLength(value),
      bytes: Buffer.byteLength(key) + Buffer.byteLength(value),
      public: key.startsWith('NEXT_PUBLIC_'), empty: value.length === 0,
      needsExpansion: /\$\{?[A-Za-z_]/.test(value)}];
  }).sort((first, second) => second.bytes - first.bytes || first.key.localeCompare(second.key));
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  return {count: entries.length, bytes, limitBytes: LAMBDA_ENVIRONMENT_LIMIT_BYTES,
    remainingBytes: LAMBDA_ENVIRONMENT_LIMIT_BYTES - bytes,
    missingKeys: keys.filter(key => typeof environment[key] !== 'string'), entries};
}

export function deploymentLogKeys(log) {
  return [...new Set([...log.matchAll(/- ([A-Z][A-Z0-9_]*)\s*$/gm)].map(match => match[1]))];
}

/** Diagnostic only: a decoded JWT claim is not proof of actual authorization. */
export function assessPublicRole(environment) {
  const value = environment.NEXT_PUBLIC_SUPABASE_ROLE_KEY;
  if (typeof value !== 'string') return 'ABSENT';
  let privilegedClaim = false;
  try { privilegedClaim = JSON.parse(Buffer.from(value.split('.')[1] ?? '', 'base64url').toString()).role === 'service_role'; }
  catch { /* Non-JWT values still require the checks below. */ }
  return value.startsWith('sb_secret_') || (value.length > 0 && value === environment.SUPABASE_SERVICE_ROLE_KEY)
    || privilegedClaim ? 'POTENTIALLY_PRIVILEGED' : 'PRESENT_REQUIRES_REVIEW';
}

function argumentsForAudit(argumentsList) {
  const files = []; let logPath;
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    if (argument === '--deploy-log') {
      if (logPath || !argumentsList[index + 1] || argumentsList[index + 1].startsWith('--')) throw new Error('INVALID_ARGUMENTS');
      logPath = argumentsList[++index];
    } else if (argument.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    else files.push(argument);
  }
  if (!files.length) throw new Error('ENVIRONMENT_FILE_REQUIRED');
  return {files, logPath};
}

export function auditFiles(argumentsList) {
  const {files, logPath} = argumentsForAudit(argumentsList);
  const keys = logPath ? deploymentLogKeys(readFileSync(resolve(logPath), 'utf8')) : undefined;
  if (keys && !keys.length) throw new Error('DEPLOYMENT_KEYS_NOT_FOUND');
  const measurements = files.map(file => {
    const content = readFileSync(resolve(file), 'utf8');
    const environment = parseEnv(content);
    return {file, fileBytes: Buffer.byteLength(content), all: measureEnvironment(environment),
      deploymentKeySubset: keys ? measureEnvironment(environment, keys) : undefined,
      publicRoleAssessment: assessPublicRole(environment)};
  });
  return {measurement: 'LOCAL_KEY_VALUE_BYTES_NOT_REMOTE_FUNCTION_PAYLOAD',
    deploymentKeyCount: keys?.length, measurements};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(auditFiles(process.argv.slice(2)), null, 2)); }
  catch {
    // Do not print parser/IO errors: their messages may contain secret source text.
    console.error('ENVIRONMENT_AUDIT_FAILED: check file access, arguments and Node parseEnv support. No values were printed.');
    process.exitCode = 1;
  }
}

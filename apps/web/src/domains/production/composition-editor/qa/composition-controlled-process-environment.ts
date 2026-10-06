const CONTROLLED_PROCESS_OS_VARIABLES = ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"] as const;

/** Absolute executable paths are supplied by the caller; application credentials are never inherited. */
export function createControlledProcessEnvironment(source: Readonly<Record<string, string | undefined>> = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {NODE_ENV: "production", HYPERFRAMES_NO_TELEMETRY: "1"};
  for (const name of CONTROLLED_PROCESS_OS_VARIABLES) if (source[name]) environment[name] = source[name];
  return environment;
}

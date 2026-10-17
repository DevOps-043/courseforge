import {isAbsolute, resolve} from "node:path";

const CONTROLLED_PROCESS_OS_VARIABLES = ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"] as const;

/** Absolute executable paths are supplied by the caller; application credentials are never inherited. */
export function createControlledProcessEnvironment(source: Readonly<Record<string, string | undefined>> = process.env,
  ownedTemporaryDirectory?: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {NODE_ENV: "production", HYPERFRAMES_NO_TELEMETRY: "1"};
  for (const name of CONTROLLED_PROCESS_OS_VARIABLES) if (source[name]) environment[name] = source[name];
  if (ownedTemporaryDirectory !== undefined) {
    if (!isAbsolute(ownedTemporaryDirectory) || resolve(ownedTemporaryDirectory) !== ownedTemporaryDirectory
      || ownedTemporaryDirectory.includes("\0") || ownedTemporaryDirectory.startsWith("\\\\"))
      throw new Error("CONTROLLED_RENDER_TEMP_DIRECTORY_INVALID");
    // Override all aliases, including differently-cased Windows names; do not retain a supervisor TEMP.
    for (const name of Object.keys(environment)) if (["TEMP", "TMP", "TMPDIR"].includes(name.toUpperCase())) delete environment[name];
    environment.TEMP = environment.TMP = environment.TMPDIR = ownedTemporaryDirectory;
  }
  return environment;
}

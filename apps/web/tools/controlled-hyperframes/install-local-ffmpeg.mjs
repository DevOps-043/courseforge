/** Explicit opt-in binary download. No global install or inherited download overrides. */
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {readFile} from "node:fs/promises";

const root = dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const metadata = require.resolve("ffmpeg-static/package.json");
const pkg = JSON.parse(await readFile(metadata, "utf8"));
if (pkg.version !== "5.3.0" || pkg["ffmpeg-static"]?.["binary-release-tag"] !== "b6.1.1")
  throw new Error("CONTROLLED_RENDER_FFMPEG_PACKAGE_INVALID");
const env = {CI: "1", XDG_CACHE_HOME: join(root, ".cache"), LOCALAPPDATA: join(root, ".cache")};
for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"])
  if (process.env[name]) env[name] = process.env[name];
const result = spawnSync(process.execPath, [join(dirname(metadata), "install.js")],
  {env, cwd: root, timeout: 300000, windowsHide: true, encoding: "utf8", maxBuffer: 65536});
// Do not forward arbitrary downloader URLs/errors or credentials from failures.
if (result.error || result.status !== 0) {
  process.stderr.write("CONTROLLED_RENDER_FFMPEG_INSTALL_FAILED\n"); process.exitCode = 1;
} else process.stdout.write("CONTROLLED_RENDER_FFMPEG_INSTALLED\n");

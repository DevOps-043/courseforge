import {execFile} from "node:child_process";

/** Waits for the direct child's close, even when execFile reports abort/error earlier.
 * Descendant containment and uncertain termination still belong to the enclosing Windows job.
 * Do not delete work files on rejection; the worker owner must confirm tree closure/fence. */
export function executeClosedStageFile(binary, args, options, launch = execFile) {
  return new Promise((resolve, reject) => {
    let outcome, closed = false, failedToSpawn = false;
    const settle = () => {
      if ((!closed && !failedToSpawn) || !outcome) return;
      if (outcome.error) reject(new Error("CONTROLLED_RENDER_STAGE_PROCESS_FAILED"));
      else resolve({stdout: String(outcome.stdout ?? ""), stderr: String(outcome.stderr ?? "")});
    };
    let child;
    try {
      child = launch(binary, args, {...options, encoding: "utf8"}, (error, stdout, stderr) => {
        outcome = {error, stdout, stderr}; settle();
      });
      child.once("error", () => {
        if (child.pid === undefined) {failedToSpawn = true; settle();}
      });
      child.once("close", (code, signal) => {
        closed = true;
        if (code !== 0 || signal) outcome = {error: true};
        settle();
      });
    } catch {reject(new Error("CONTROLLED_RENDER_STAGE_PROCESS_FAILED"));}
  });
}

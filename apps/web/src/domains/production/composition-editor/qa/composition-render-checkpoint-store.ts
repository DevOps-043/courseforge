import {lstat,mkdir,open,realpath,rename,rm,rmdir} from "node:fs/promises";
import {isAbsolute,join,relative,sep} from "node:path";
import {createHash} from "node:crypto";
import {CONTROLLED_RENDER_CHECKPOINT_POLICY,parseControlledRenderCheckpoint,renderCheckpointScopeSchema,
  type ControlledRenderCheckpoint,type RenderCheckpointScope} from "./composition-render-checkpoint";
import {pinConformanceFile,assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {CONTROLLED_RENDER_STORAGE} from "./composition-controlled-render-storage-policy";

/** Operator-owned local journal. Does not claim shared-host recovery, OS isolation or power-loss durability. */
export class CompositionRenderCheckpointStore {
  constructor(private readonly journalDirectory:string,private readonly retainedVideoDirectory:string) {}

  async save(raw:ControlledRenderCheckpoint) {
    const checkpoint = parseControlledRenderCheckpoint(raw,raw.scope);
    const bytes = JSON.stringify(checkpoint);
    if (Buffer.byteLength(bytes,"utf8") > CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes)
      throw new Error("RENDER_SUPERVISOR_CHECKPOINT_TOO_LARGE");
    await this.assertVideo(checkpoint);
    const directory = await this.directory(checkpoint.scope);
    try {await mkdir(directory,{mode:0o700});}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("RENDER_SUPERVISOR_CHECKPOINT_WRITE_FAILED");
      const previous = await this.read(checkpoint.scope);
      if (JSON.stringify(previous) !== bytes) throw new Error("RENDER_SUPERVISOR_CHECKPOINT_CONFLICT");
      return;
    }
    const pending = join(directory,"pending.json"), ready = join(directory,"checkpoint.json");
    let published = false;
    try {
      const handle = await open(pending,"wx",0o600);
      try {await handle.writeFile(bytes,"utf8"); await handle.sync();} finally {await handle.close();}
      await this.assertVideo(checkpoint);
      // Exclusive per-execution directory prevents concurrent publishers from overwriting the ready record.
      await rename(pending,ready); published = true;
    } catch {
      if (!published) {
        try {await rm(pending,{force:true}); await rmdir(directory);}
        catch {throw new Error("RENDER_SUPERVISOR_CHECKPOINT_CLEANUP_UNCONFIRMED");}
      }
      throw new Error("RENDER_SUPERVISOR_CHECKPOINT_WRITE_FAILED");
    }
  }

  async read(scope:RenderCheckpointScope) {
    try {
      const expected = renderCheckpointScopeSchema.parse(scope);
      const directory = await this.directory(expected);
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) throw new Error();
      const path = join(directory,"checkpoint.json");
      const pin = await pinConformanceFile(path,CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes);
      const handle = await open(path,"r");
      const chunks:Buffer[] = []; let size = 0;
      try {
        for await (const chunk of handle.createReadStream({autoClose:false})) {
          const bytes = chunk as Buffer; size += bytes.length;
          if (size > pin.sizeBytes || size > CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes) throw new Error();
          chunks.push(bytes);
        }
      } finally {await handle.close();}
      const bytes = Buffer.concat(chunks,size).toString("utf8");
      if (Buffer.byteLength(bytes,"utf8") !== pin.sizeBytes || createHash("sha256").update(bytes,"utf8").digest("hex") !== pin.sha256)
        throw new Error();
      const checkpoint = parseControlledRenderCheckpoint(JSON.parse(bytes),expected);
      await assertConformanceFileUnchanged(path,pin,CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes);
      await this.assertVideo(checkpoint);
      return checkpoint;
    } catch {throw new Error("RENDER_SUPERVISOR_CHECKPOINT_READ_FAILED");}
  }

  private async directory(scope:RenderCheckpointScope) {
    const expected = renderCheckpointScopeSchema.parse(scope);
    const root = await this.ownedDirectory(this.journalDirectory);
    return join(root,`${expected.organizationId}-${expected.requestId}-${expected.executionId}`);
  }

  private async ownedDirectory(path:string) {
    try {
      if (!isAbsolute(path)) throw new Error();
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
      return await realpath(path);
    } catch {throw new Error("RENDER_SUPERVISOR_CHECKPOINT_DIRECTORY_INVALID");}
  }

  private async assertVideo(checkpoint:ControlledRenderCheckpoint) {
    try {
    const root = await this.ownedDirectory(this.retainedVideoDirectory);
    const path = await realpath(checkpoint.videoPath), tail = relative(root,path);
    if (path !== checkpoint.videoPath || !tail || isAbsolute(tail) || tail === ".." || tail.startsWith(`..${sep}`))
      throw new Error("RENDER_SUPERVISOR_CHECKPOINT_VIDEO_OWNERSHIP_INVALID");
    const pin = await pinConformanceFile(path,CONTROLLED_RENDER_STORAGE.maximumVideoBytes);
    const binding = checkpoint.supervisorReceipt.payload.binding;
    if (pin.sha256 !== binding.videoSha256 || pin.sizeBytes !== binding.sizeBytes)
      throw new Error("RENDER_SUPERVISOR_CHECKPOINT_VIDEO_MISMATCH");
    } catch (error) {
      if (error instanceof Error && /^RENDER_SUPERVISOR_CHECKPOINT_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error("RENDER_SUPERVISOR_CHECKPOINT_VIDEO_INVALID");
    }
  }
}

import type { z } from "zod";

/** Incrementally bounds untrusted bytes before allocating/parsing JSON. Never
 * buffers an unlimited request.text(); cancels on overflow or abort. */
export async function readHtmlSnapshotRequestBody<T>(request:Request,schema:z.ZodType<T>,maximumBytes:number,signal:AbortSignal):
  Promise<{success:true;data:T} | {success:false;reason:"invalid" | "too_large"}> {
  const length=request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length)>maximumBytes))
    return {success:false,reason:/^\d+$/.test(length) ? "too_large" : "invalid"};
  if (!request.body) return {success:false,reason:"invalid"};
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  const cancel=() => {void reader.cancel().catch(() => undefined);};
  signal.addEventListener("abort",cancel,{once:true});
  try {
    while (true) {
      signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if (chunk.done) break;
      size+=chunk.value.byteLength;if (size>maximumBytes) return {success:false,reason:"too_large"};
      chunks.push(new Uint8Array(chunk.value));
    }
    const bytes=new Uint8Array(size);let offset=0;
    for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const result=schema.safeParse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
    return result.success ? {success:true,data:result.data} : {success:false,reason:"invalid"};
  } catch {return {success:false,reason:"invalid"};}
  finally {signal.removeEventListener("abort",cancel);await reader.cancel().catch(() => undefined);reader.releaseLock();}
}

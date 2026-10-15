import { resolve } from "node:path";
import { compileVideoCorpusFromReceipts } from "./composition-video-corpus-compile";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 8 || args.some((value, index) => index % 2 === 0 ? value !== "--receipt" : !value || value.startsWith("--")))
    throw new Error("CONFORMANCE_CORPUS_RECEIPT_ARGUMENTS_INVALID");
  const report = await compileVideoCorpusFromReceipts(args.filter((_, index) => index % 2 === 1).map((path) => resolve(path)));
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().catch((error: unknown) => {
  const code = error instanceof Error && /^CONFORMANCE_CORPUS_[A-Z_]+$/.test(error.message)
    ? error.message : "CONFORMANCE_CORPUS_COMPILE_FAILED";
  process.stderr.write(`${code}\n`); process.exitCode = 1;
});

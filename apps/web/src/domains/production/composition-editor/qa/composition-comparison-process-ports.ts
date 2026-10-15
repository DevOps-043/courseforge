import type {consumeDecodedPcm} from "./composition-pcm-decoder-stream";

/** Operator-owned execution only. Each operation must settle after confirmed process-tree closure.
 * A port is not proof of OS containment; production must supply the selected host implementation. */
export type ComparisonProcessPorts = {
  pixelDecoderPath: string;
  probePath: string;
  execute: (binary: string, arguments_: string[], options: {
    maxBuffer: number; timeout: number; windowsHide: boolean; encoding: "utf8";
    signal?: AbortSignal; env: NodeJS.ProcessEnv;
  }) => Promise<{stdout: string; stderr: string}>;
  consumePcm: typeof consumeDecodedPcm;
};

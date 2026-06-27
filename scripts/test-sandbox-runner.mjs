import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const request = {
  jobId: 'test-001',
  templateVersionId: 'test-version-id',
  bundleHash: 'test-hash-alternating-v2',
  bundleZipPath: path.resolve('./remotion-template-alternating-v2.zip'),
  entryPoint: 'src/index.tsx',
  compositionId: 'alternating-focus-v1',
  inputProps: {
    template: 'alternating-focus-v1',
    fps: 30,
    totalDurationInFrames: 300,
    avatarVideoUrl: undefined,
    slides: [],
    brollClips: [],
    transitionType: 'fade',
    templateConfig: {
      accentColor: '#00D4B3',
      backgroundColor: '#000000',
      surfaceColor: '#151A21',
      transitionType: 'fade',
      avatarPosition: 'bottom-right',
      avatarScale: 0.24,
      supportStripHeight: 0.22,
      backgroundStyle: 'gradient',
    },
  },
  assetAllowlist: [],
};

const child = spawn(
  'node',
  ['apps/api/dist/features/production/sandbox-runner/index.js'],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);

child.stdin.end(JSON.stringify(request));

let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});

child.on('exit', (code) => {
  console.log('Exit code:', code);
  console.log('Output:', stdout);

  try {
    const trimmed = stdout.trim();
    const lastJsonObject = trimmed.match(/\{[\s\S]*\}\s*$/);
    const result = JSON.parse(lastJsonObject ? lastJsonObject[0] : trimmed);
    if (result.outputPath && fs.existsSync(result.outputPath)) {
      console.log('Video generado en:', result.outputPath);
    } else {
      console.error('Error:', result.error);
    }
  } catch {
    console.error('Output no es JSON valido');
  }
});

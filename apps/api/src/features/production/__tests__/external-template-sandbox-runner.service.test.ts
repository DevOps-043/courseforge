import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExternalTemplateSandboxRunner } from '../external-template-sandbox-runner.service';

describe('ExternalTemplateSandboxRunner', () => {
  it('is disabled by default and does not execute a local runner', async () => {
    const previousFlag = process.env.EXTERNAL_TEMPLATE_SANDBOX_ENABLED;
    const previousCommand = process.env.EXTERNAL_TEMPLATE_SANDBOX_COMMAND;
    delete process.env.EXTERNAL_TEMPLATE_SANDBOX_ENABLED;
    process.env.EXTERNAL_TEMPLATE_SANDBOX_COMMAND = 'this-command-must-not-run';

    try {
      const runner = new ExternalTemplateSandboxRunner();
      const result = await runner.render({
        jobId: 'job-1',
        templateVersionId: 'version-1',
        bundleHash: 'hash',
        entryPoint: 'src/index.tsx',
        compositionId: 'composition',
        inputProps: {},
        assetAllowlist: [],
      });

      assert.equal(runner.isEnabled(), false);
      assert.equal(result.success, false);
      assert.match(result.error || '', /disabled/i);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.EXTERNAL_TEMPLATE_SANDBOX_ENABLED;
      } else {
        process.env.EXTERNAL_TEMPLATE_SANDBOX_ENABLED = previousFlag;
      }

      if (previousCommand === undefined) {
        delete process.env.EXTERNAL_TEMPLATE_SANDBOX_COMMAND;
      } else {
        process.env.EXTERNAL_TEMPLATE_SANDBOX_COMMAND = previousCommand;
      }
    }
  });
});

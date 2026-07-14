import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DesktopWorkerProvider } from '../desktop-worker.provider';

describe('DesktopWorkerProvider', () => {
  it('leaves jobs waiting for an external desktop worker', async () => {
    const provider = new DesktopWorkerProvider();
    const result = await provider.dispatch('job-1');

    assert.equal(provider.name, 'desktop_worker');
    assert.equal(result.provider, 'desktop_worker');
    assert.equal(result.status, 'WAITING_PROVIDER');
  });
});

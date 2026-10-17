import assert from 'node:assert/strict';
import test from 'node:test';
import {measureEnvironment, deploymentLogKeys, assessPublicRole} from './audit-environment-budget.mjs';

test('measures UTF-8 keys and values, including empty values', () => {
  const result = measureEnvironment({UNICODE: 'á🙂', EMPTY: ''});
  assert.equal(result.bytes, 7 + 6 + 5);
  assert.equal(result.count, 2);
  assert.equal(result.entries.find(entry => entry.key === 'EMPTY').empty, true);
});

test('reports missing remote keys without guessing values', () => {
  const result = measureEnvironment({KNOWN: 'true'}, ['KNOWN', 'ABSENT']);
  assert.equal(result.bytes, 9);
  assert.deepEqual(result.missingKeys, ['ABSENT']);
});

test('never serializes values or decoded token claims', () => {
  const encoded = JSON.stringify(measureEnvironment({PRIVATE_KEY: 'secret-do-not-print'}));
  assert.equal(encoded.includes('secret-do-not-print'), false);
  assert.equal(encoded.includes('PRIVATE_KEY'), true);
});

test('counts duplicate subset keys once and identifies expansion uncertainty', () => {
  const result = measureEnvironment({NEXT_PUBLIC_FLAG: '${PRIVATE_KEY}'}, ['NEXT_PUBLIC_FLAG', 'NEXT_PUBLIC_FLAG']);
  assert.equal(result.count, 1);
  assert.equal(result.entries[0].needsExpansion, true);
  assert.equal(result.entries[0].public, true);
});

test('extracts unique variable names from timestamped deployment log', () => {
  const keys = deploymentLogKeys('12:51:20 PM:       - KNOWN\r\n12:51:20 PM:       - KNOWN\r\n12:51:20 PM:       - OTHER\r\n');
  assert.deepEqual(keys, ['KNOWN', 'OTHER']);
});

test('signals aggregate overflow rather than silently capping it', () => {
  const result = measureEnvironment({KEY: 'a'.repeat(4096)});
  assert.equal(result.bytes, 4099);
  assert.equal(result.remainingBytes, -3);
});

test('public role assessment distinguishes absent, privileged candidates and unknown values', () => {
  assert.equal(assessPublicRole({}), 'ABSENT');
  assert.equal(assessPublicRole({NEXT_PUBLIC_SUPABASE_ROLE_KEY: 'sb_secret_example'}), 'POTENTIALLY_PRIVILEGED');
  assert.equal(assessPublicRole({NEXT_PUBLIC_SUPABASE_ROLE_KEY: 'same', SUPABASE_SERVICE_ROLE_KEY: 'same'}), 'POTENTIALLY_PRIVILEGED');
  const claim = Buffer.from(JSON.stringify({role: 'service_role'})).toString('base64url');
  assert.equal(assessPublicRole({NEXT_PUBLIC_SUPABASE_ROLE_KEY: `header.${claim}.signature`}), 'POTENTIALLY_PRIVILEGED');
  assert.equal(assessPublicRole({NEXT_PUBLIC_SUPABASE_ROLE_KEY: 'unclassified'}), 'PRESENT_REQUIRES_REVIEW');
  assert.equal(assessPublicRole({NEXT_PUBLIC_SUPABASE_ROLE_KEY: '', SUPABASE_SERVICE_ROLE_KEY: ''}), 'PRESENT_REQUIRES_REVIEW');
});

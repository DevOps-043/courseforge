import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildResolvedProps,
  stableHash,
  stableStringify,
} from '../resolved-props.service';

describe('resolved props contract', () => {
  it('merges defaults, course props and explicit overrides in precedence order', () => {
    const result = buildResolvedProps({
      bundleDefaultProps: {
        title: 'Default title',
        theme: 'dark',
        nested: { from: 'defaults' },
      },
      courseProps: {
        title: 'Course title',
        slides: [{ index: 1, url: 'https://cdn.example.com/slide.png' }],
      },
      userOverrides: {
        title: 'Override title',
        accentColor: '#00D4B3',
      },
    });

    assert.equal(result.resolvedProps.title, 'Override title');
    assert.equal(result.resolvedProps.theme, 'dark');
    assert.deepEqual(result.resolvedProps.nested, { from: 'defaults' });
    assert.deepEqual(result.resolvedProps.slides, [
      { index: 1, url: 'https://cdn.example.com/slide.png' },
    ]);
    assert.equal(result.resolvedProps.accentColor, '#00D4B3');
    assert.match(result.propsHash, /^[a-f0-9]{64}$/);
  });

  it('hashes objects independently of key insertion order', () => {
    const left = {
      z: 1,
      a: {
        second: true,
        first: ['one', 'two'],
      },
    };
    const right = {
      a: {
        first: ['one', 'two'],
        second: true,
      },
      z: 1,
    };

    assert.equal(stableStringify(left), stableStringify(right));
    assert.equal(stableHash(left), stableHash(right));
  });

  it('changes the hash when arrays change order', () => {
    assert.notEqual(
      stableHash({ slides: ['one', 'two'] }),
      stableHash({ slides: ['two', 'one'] }),
    );
  });
});

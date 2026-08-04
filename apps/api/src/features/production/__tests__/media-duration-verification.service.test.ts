import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyMediaDurationsFromUrls } from '../media-duration-verification.service';

describe('media duration verification', () => {
  it('overwrites persisted media durations with durations measured from asset URLs', async () => {
    const result = await verifyMediaDurationsFromUrls(
      {
        voice_audio: {
          public_url: 'https://cdn.example.com/voice.mp3',
          duration: 51,
        },
        avatar_video: {
          public_url: 'https://cdn.example.com/avatar.mp4',
          duration: 51,
        },
        b_roll_clips: [
          {
            public_url: 'https://cdn.example.com/broll.mp4',
            duration: 180,
            order: 1,
          },
        ],
        avatar_clips: [
          {
            public_url: 'https://cdn.example.com/avatar-scene-2.mp4',
            duration: 20,
            order: 2,
          },
          {
            public_url: 'https://cdn.example.com/avatar-scene-1.mp4',
            duration: 20,
            order: 1,
          },
        ],
      },
      async (url) => {
        if (url.endsWith('avatar.mp4')) return 165.2;
        if (url.endsWith('voice.mp3')) return 161.6;
        if (url.endsWith('broll.mp4')) return 7.3;
        if (url.endsWith('avatar-scene-1.mp4')) return 4.2;
        if (url.endsWith('avatar-scene-2.mp4')) return 5.8;
        return null;
      },
    );

    const assets = result.assets as any;
    assert.equal(assets.voice_audio.duration, 161.6);
    assert.equal(assets.avatar_video.duration, 165.2);
    assert.equal(assets.b_roll_clips[0].duration, 7.3);
    assert.equal(assets.avatar_clips[0].duration, 5.8);
    assert.equal(assets.avatar_clips[1].duration, 4.2);
    assert.deepEqual(result.measuredDurations, {
      voice_audio: 161.6,
      avatar_video: 165.2,
      'b_roll_clips.1': 7.3,
      'avatar_clips.2': 5.8,
      'avatar_clips.1': 4.2,
    });
    assert.deepEqual(result.failedMeasurements, []);
  });

  it('preserves sub-second precision without rounding video durations upward', async () => {
    const result = await verifyMediaDurationsFromUrls(
      {
        avatar_video: {
          public_url: 'https://cdn.example.com/avatar-edge.mp4',
          duration: 20,
        },
      },
      async () => 19.7289,
    );

    const assets = result.assets as any;
    assert.equal(assets.avatar_video.duration, 19.728);
    assert.deepEqual(result.measuredDurations, {
      avatar_video: 19.728,
    });
  });

  it('removes persisted duration when an asset URL cannot be measured', async () => {
    const result = await verifyMediaDurationsFromUrls(
      {
        avatar_video: {
          public_url: 'https://cdn.example.com/avatar.mp4',
          duration: 51,
        },
      },
      async () => null,
    );

    const assets = result.assets as any;
    assert.equal(assets.avatar_video.duration, undefined);
    assert.deepEqual(result.measuredDurations, {});
    assert.deepEqual(result.failedMeasurements, ['avatar_video']);
  });
});

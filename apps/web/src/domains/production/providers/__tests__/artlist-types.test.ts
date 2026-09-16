import assert from "node:assert/strict";
import test from "node:test";
import {
  isArtlistTrack,
  isArtlistVideo,
  parseArtlistSearchResults,
} from "../artlist.types";

const track = {
  artist: "Artist",
  duration_seconds: 120,
  genre: "Ambient",
  id: "track-1",
  mood: "Focused",
  public_url: "https://cdn.example.com/track.mp3",
  title: "Focus",
};

const video = {
  duration_seconds: 10,
  id: "video-1",
  public_url: "https://cdn.example.com/video.mp4",
  tags: ["coding"],
  title: "Coding",
};

test("Artlist result guards discriminate tracks and videos", () => {
  assert.equal(isArtlistTrack(track), true);
  assert.equal(isArtlistVideo(track), false);
  assert.equal(isArtlistTrack(video), false);
  assert.equal(isArtlistVideo(video), true);
});

test("Artlist parsing drops malformed provider payloads", () => {
  assert.deepEqual(parseArtlistSearchResults([track, video, { id: "broken" }], "music"), [track]);
  assert.deepEqual(parseArtlistSearchResults([track, video, null], "video"), [video]);
  assert.deepEqual(parseArtlistSearchResults({ results: [track] }, "music"), []);
});

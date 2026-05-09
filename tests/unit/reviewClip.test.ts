import assert from "node:assert/strict";
import test from "node:test";
import { createNonSilentReviewClip } from "../../src/audio/reviewClip.ts";
import { parseWavFormat } from "../../src/audio/wav.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("createNonSilentReviewClip scans past leading silence", () => {
  const sampleRateHz = 44100;
  const source = createPcmWavFixture({ frames: sampleRateHz * 8 });
  const audibleFrame = sampleRateHz * 3;
  source.writeInt16LE(12000, 44 + audibleFrame * 2 * 2);
  source.writeInt16LE(12000, 44 + (audibleFrame * 2 + 1) * 2);

  const clip = createNonSilentReviewClip(source);
  const parsed = parseWavFormat(clip.bytes);

  assert.equal(clip.containsAudio, true);
  assert.equal(parsed.durationSeconds, 5);
  assert.ok(clip.startSeconds >= 2.7);
  assert.ok(clip.startSeconds <= 2.8);
});

test("createNonSilentReviewClip marks all-silent clips", () => {
  const source = createPcmWavFixture({ frames: 44100 });
  const clip = createNonSilentReviewClip(source);

  assert.equal(clip.containsAudio, false);
  assert.equal(clip.startSeconds, 0);
  assert.equal(clip.durationSeconds, 1);
});

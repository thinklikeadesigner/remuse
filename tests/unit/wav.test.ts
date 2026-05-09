import assert from "node:assert/strict";
import test from "node:test";
import { assertCanonicalInternalWav, parseWavFormat } from "../../src/audio/wav.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("parseWavFormat reads canonical 24-bit 44.1 kHz PCM WAV metadata", () => {
  const parsed = parseWavFormat(createPcmWavFixture({ frames: 10 }));

  assert.equal(parsed.format.container, "WAV");
  assert.equal(parsed.format.codec, "PCM");
  assert.equal(parsed.format.sampleRateHz, 44100);
  assert.equal(parsed.format.bitDepth, 24);
  assert.equal(parsed.format.channels, 2);
  assert.equal(parsed.dataBytes, 60);
});

test("assertCanonicalInternalWav rejects non-canonical bit depth", () => {
  assert.throws(
    () => assertCanonicalInternalWav(createPcmWavFixture({ bitDepth: 16 })),
    /Canonical input must be 24-bit PCM WAV/
  );
});

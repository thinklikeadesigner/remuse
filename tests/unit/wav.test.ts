import assert from "node:assert/strict";
import test from "node:test";
import { assertCanonicalInternalWav, assertSupportedWorkflowWav, parseWavFormat } from "../../src/audio/wav.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("parseWavFormat reads canonical 16-bit 44.1 kHz PCM WAV metadata", () => {
  const parsed = parseWavFormat(createPcmWavFixture({ frames: 10 }));

  assert.equal(parsed.format.container, "WAV");
  assert.equal(parsed.format.codec, "PCM");
  assert.equal(parsed.format.sampleRateHz, 44100);
  assert.equal(parsed.format.bitDepth, 16);
  assert.equal(parsed.format.channels, 2);
  assert.equal(parsed.dataBytes, 40);
});

test("assertSupportedWorkflowWav accepts 16-bit and 24-bit WAV", () => {
  assert.equal(assertSupportedWorkflowWav(createPcmWavFixture({ bitDepth: 16 })).format.bitDepth, 16);
  assert.equal(assertSupportedWorkflowWav(createPcmWavFixture({ bitDepth: 24 })).format.bitDepth, 24);
});

test("assertCanonicalInternalWav rejects non-canonical bit depth", () => {
  assert.throws(
    () => assertCanonicalInternalWav(createPcmWavFixture({ bitDepth: 24 })),
    /Canonical audio must be 16-bit PCM WAV/
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { renderResidualReverbWav } from "../../src/audio/residual.ts";
import { parseWavFormat } from "../../src/audio/wav.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

function readSample16(buffer: Buffer, sampleIndex: number): number {
  return buffer.readInt16LE(44 + sampleIndex * 2) / 32768;
}

test("renderResidualReverbWav writes a 16-bit residual WAV", () => {
  const original = createPcmWavFixture({
    channels: 2,
    frames: 2,
    samples: [0.5, -0.5, 0.25, -0.25]
  });
  const dry = createPcmWavFixture({
    channels: 2,
    frames: 2,
    samples: [0.25, -0.25, 0.1, -0.1]
  });

  const residual = renderResidualReverbWav(original, dry);
  const parsed = parseWavFormat(residual);

  assert.equal(parsed.format.bitDepth, 16);
  assert.equal(parsed.format.channels, 2);
  assert.equal(parsed.dataBytes, 8);
  assert.ok(Math.abs(readSample16(residual, 0) - 0.25) < 0.002);
  assert.ok(Math.abs(readSample16(residual, 1) - -0.25) < 0.002);
  assert.ok(Math.abs(readSample16(residual, 2) - 0.15) < 0.002);
  assert.ok(Math.abs(readSample16(residual, 3) - -0.15) < 0.002);
});

test("renderResidualReverbWav rejects channel mismatches", () => {
  assert.throws(
    () =>
      renderResidualReverbWav(
        createPcmWavFixture({ channels: 2 }),
        createPcmWavFixture({ channels: 1 })
      ),
    /different channel counts/
  );
});

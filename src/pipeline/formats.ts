import type { AudioFormat } from "./types.ts";

export const CANONICAL_INTERNAL_WAV_FORMAT: AudioFormat = {
  container: "WAV",
  codec: "PCM",
  sampleRateHz: 44100,
  bitDepth: 24,
  channels: 2
};

export const FINAL_OUTPUT_WAV_FORMAT: AudioFormat = {
  container: "WAV",
  codec: "PCM",
  sampleRateHz: 44100,
  bitDepth: 16,
  channels: 2
};

export function isCanonicalInternalWav(format: AudioFormat): boolean {
  return (
    format.container === CANONICAL_INTERNAL_WAV_FORMAT.container &&
    format.codec === CANONICAL_INTERNAL_WAV_FORMAT.codec &&
    format.sampleRateHz === CANONICAL_INTERNAL_WAV_FORMAT.sampleRateHz &&
    format.bitDepth === CANONICAL_INTERNAL_WAV_FORMAT.bitDepth
  );
}

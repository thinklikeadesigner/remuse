export function createPcmWavFixture(input: {
  sampleRateHz?: number;
  channels?: number;
  bitDepth?: 16 | 24;
  frames?: number;
  samples?: number[];
} = {}): Buffer {
  const sampleRateHz = input.sampleRateHz ?? 44100;
  const channels = input.channels ?? 2;
  const bitDepth = input.bitDepth ?? 16;
  const frames = input.frames ?? 8;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRateHz * blockAlign;
  const dataBytes = frames * blockAlign;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  if (input.samples !== undefined) {
    input.samples.slice(0, frames * channels).forEach((sample, index) => {
      const clipped = Math.max(-1, Math.min(1, sample));
      const offset = 44 + index * bytesPerSample;

      if (bitDepth === 16) {
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(clipped * 32767))), offset);
      } else {
        buffer.writeIntLE(Math.max(-8388608, Math.min(8388607, Math.round(clipped * 8388607))), offset, 3);
      }
    });
  }

  return buffer;
}

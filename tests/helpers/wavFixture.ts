export function createPcmWavFixture(input: {
  sampleRateHz?: number;
  channels?: number;
  bitDepth?: 16 | 24;
  frames?: number;
} = {}): Buffer {
  const sampleRateHz = input.sampleRateHz ?? 44100;
  const channels = input.channels ?? 2;
  const bitDepth = input.bitDepth ?? 24;
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

  return buffer;
}

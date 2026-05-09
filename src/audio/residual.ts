import { parseWavFormat } from "./wav.ts";

type PcmWavView = {
  bitDepth: 16 | 24;
  channels: 1 | 2;
  sampleRateHz: 44100;
  dataStart: number;
  dataBytes: number;
  frameCount: number;
};

function readAscii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString("ascii");
}

function findDataStart(buffer: Buffer): { dataStart: number; dataBytes: number } {
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkEnd > buffer.length) {
      throw new Error(`WAV chunk ${chunkId} extends beyond file length.`);
    }

    if (chunkId === "data") {
      return {
        dataStart: chunkStart,
        dataBytes: chunkSize
      };
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  throw new Error("WAV data chunk was not found.");
}

function pcmView(buffer: Buffer): PcmWavView {
  const parsed = parseWavFormat(buffer);
  const data = findDataStart(buffer);
  const bytesPerFrame = parsed.format.channels * (parsed.format.bitDepth / 8);

  return {
    bitDepth: parsed.format.bitDepth,
    channels: parsed.format.channels,
    sampleRateHz: parsed.format.sampleRateHz,
    dataStart: data.dataStart,
    dataBytes: data.dataBytes,
    frameCount: Math.floor(data.dataBytes / bytesPerFrame)
  };
}

function readSample(buffer: Buffer, offset: number, bitDepth: 16 | 24): number {
  if (bitDepth === 16) {
    return buffer.readInt16LE(offset) / 32768;
  }

  return buffer.readIntLE(offset, 3) / 8388608;
}

function writePcm16Header(buffer: Buffer, dataBytes: number, channels: 1 | 2): void {
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = 44100 * blockAlign;

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
}

function writeSample16(buffer: Buffer, offset: number, value: number): void {
  const clipped = Math.max(-1, Math.min(1, value));
  const sample = Math.max(-32768, Math.min(32767, Math.round(clipped * 32767)));
  buffer.writeInt16LE(sample, offset);
}

export function renderResidualReverbWav(originalBytes: Buffer, dryBytes: Buffer): Buffer {
  const original = pcmView(originalBytes);
  const dry = pcmView(dryBytes);

  if (original.channels !== dry.channels) {
    throw new Error(`Cannot render residual from WAV files with different channel counts: ${original.channels} and ${dry.channels}.`);
  }

  if (original.sampleRateHz !== dry.sampleRateHz) {
    throw new Error(`Cannot render residual from WAV files with different sample rates: ${original.sampleRateHz} and ${dry.sampleRateHz}.`);
  }

  const frameCount = Math.min(original.frameCount, dry.frameCount);
  const sampleCount = frameCount * original.channels;
  const dataBytes = sampleCount * 2;
  const output = Buffer.alloc(44 + dataBytes);
  writePcm16Header(output, dataBytes, original.channels);

  const originalBytesPerSample = original.bitDepth / 8;
  const dryBytesPerSample = dry.bitDepth / 8;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const originalSample = readSample(originalBytes, original.dataStart + sampleIndex * originalBytesPerSample, original.bitDepth);
    const drySample = readSample(dryBytes, dry.dataStart + sampleIndex * dryBytesPerSample, dry.bitDepth);
    writeSample16(output, 44 + sampleIndex * 2, originalSample - drySample);
  }

  return output;
}

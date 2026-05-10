import { parseWavFormat } from "./wav.ts";

function readAscii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString("ascii");
}

function findDataChunk(buffer: Buffer): { dataStart: number; dataBytes: number } {
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

function writePcmHeader(buffer: Buffer, input: {
  dataBytes: number;
  channels: 1 | 2;
  sampleRateHz: 44100;
  bitDepth: 16 | 24;
}): void {
  const bytesPerSample = input.bitDepth / 8;
  const blockAlign = input.channels * bytesPerSample;
  const byteRate = input.sampleRateHz * blockAlign;

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + input.dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(input.channels, 22);
  buffer.writeUInt32LE(input.sampleRateHz, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(input.bitDepth, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(input.dataBytes, 40);
}

export function fitPcmWavToFrameCount(buffer: Buffer, targetFrameCount: number): Buffer {
  if (!Number.isInteger(targetFrameCount) || targetFrameCount < 0) {
    throw new Error(`Target WAV frame count must be a non-negative integer; received ${targetFrameCount}.`);
  }

  const parsed = parseWavFormat(buffer);
  const data = findDataChunk(buffer);
  const bytesPerFrame = parsed.format.channels * (parsed.format.bitDepth / 8);
  const sourceDataBytes = Math.floor(data.dataBytes / bytesPerFrame) * bytesPerFrame;
  const targetDataBytes = targetFrameCount * bytesPerFrame;

  if (sourceDataBytes === targetDataBytes && data.dataStart === 44 && buffer.length === 44 + targetDataBytes) {
    return buffer;
  }

  const output = Buffer.alloc(44 + targetDataBytes);
  writePcmHeader(output, {
    dataBytes: targetDataBytes,
    channels: parsed.format.channels,
    sampleRateHz: parsed.format.sampleRateHz,
    bitDepth: parsed.format.bitDepth
  });
  buffer.copy(output, 44, data.dataStart, data.dataStart + Math.min(sourceDataBytes, targetDataBytes));

  return output;
}

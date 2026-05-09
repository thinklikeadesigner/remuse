import type { AudioFormat } from "../pipeline/types.ts";

export type WavParseResult = {
  format: AudioFormat;
  byteLength: number;
  dataBytes: number;
  durationSeconds?: number;
};

const riffHeaderBytes = 12;

function readAscii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString("ascii");
}

export function parseWavFormat(buffer: Buffer): WavParseResult {
  if (buffer.length < riffHeaderBytes) {
    throw new Error("WAV file is too small.");
  }

  if (readAscii(buffer, 0, 4) !== "RIFF" || readAscii(buffer, 8, 4) !== "WAVE") {
    throw new Error("WAV file must start with RIFF/WAVE headers.");
  }

  let offset = riffHeaderBytes;
  let format: AudioFormat | undefined;
  let byteRate: number | undefined;
  let dataBytes = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkEnd > buffer.length) {
      throw new Error(`WAV chunk ${chunkId} extends beyond file length.`);
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new Error("WAV fmt chunk is too small.");
      }

      const audioFormat = buffer.readUInt16LE(chunkStart);
      const channels = buffer.readUInt16LE(chunkStart + 2);
      const sampleRateHz = buffer.readUInt32LE(chunkStart + 4);
      byteRate = buffer.readUInt32LE(chunkStart + 8);
      const bitDepth = buffer.readUInt16LE(chunkStart + 14);

      if (audioFormat !== 1) {
        throw new Error(`Only PCM WAV is supported; found format code ${audioFormat}.`);
      }

      if (channels !== 1 && channels !== 2) {
        throw new Error(`Only mono or stereo WAV is supported; found ${channels} channels.`);
      }

      if (sampleRateHz !== 44100) {
        throw new Error(`Only 44.1 kHz WAV is supported; found ${sampleRateHz} Hz.`);
      }

      if (bitDepth !== 16 && bitDepth !== 24) {
        throw new Error(`Only 16-bit or 24-bit PCM WAV is supported; found ${bitDepth}-bit.`);
      }

      format = {
        container: "WAV",
        codec: "PCM",
        sampleRateHz,
        bitDepth,
        channels
      };
    } else if (chunkId === "data") {
      dataBytes += chunkSize;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (format === undefined) {
    throw new Error("WAV fmt chunk was not found.");
  }

  if (dataBytes === 0) {
    throw new Error("WAV data chunk was not found or is empty.");
  }

  return {
    format,
    byteLength: buffer.length,
    dataBytes,
    ...(byteRate === undefined || byteRate === 0 ? {} : { durationSeconds: dataBytes / byteRate })
  };
}

export function assertCanonicalInternalWav(buffer: Buffer): WavParseResult {
  const parsed = parseWavFormat(buffer);

  if (parsed.format.bitDepth !== 16) {
    throw new Error(`Canonical audio must be 16-bit PCM WAV; found ${parsed.format.bitDepth}-bit.`);
  }

  return parsed;
}

export function assertSupportedWorkflowWav(buffer: Buffer): WavParseResult {
  return parseWavFormat(buffer);
}

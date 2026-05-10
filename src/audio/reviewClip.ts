import type { AudioFormat } from "../pipeline/types.ts";

export type ReviewClipResult = {
  bytes: Buffer;
  startSeconds: number;
  durationSeconds: number;
  containsAudio: boolean;
};

export type ReviewClipOptions = {
  durationSeconds?: number;
  preRollSeconds?: number;
  silenceThreshold?: number;
};

type PcmWavData = {
  format: AudioFormat;
  dataStart: number;
  dataBytes: number;
  frameCount: number;
  bytesPerSample: number;
  blockAlign: number;
};

function readAscii(buffer: Buffer, start: number, length: number): string {
  return buffer.toString("ascii", start, start + length);
}

function parsePcmWavData(buffer: Buffer): PcmWavData {
  if (buffer.length < 44 || readAscii(buffer, 0, 4) !== "RIFF" || readAscii(buffer, 8, 4) !== "WAVE") {
    throw new Error("Review clips require a PCM RIFF/WAVE file.");
  }

  let offset = 12;
  let format: AudioFormat | undefined;
  let dataStart: number | undefined;
  let dataBytes: number | undefined;

  while (offset + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkStart + chunkSize > buffer.length) {
      throw new Error(`WAV chunk ${chunkId} extends beyond file length.`);
    }

    if (chunkId === "fmt ") {
      const audioFormat = buffer.readUInt16LE(chunkStart);
      const channels = buffer.readUInt16LE(chunkStart + 2);
      const sampleRateHz = buffer.readUInt32LE(chunkStart + 4);
      const bitDepth = buffer.readUInt16LE(chunkStart + 14);

      if (audioFormat !== 1 || (channels !== 1 && channels !== 2) || sampleRateHz !== 44100 || (bitDepth !== 16 && bitDepth !== 24)) {
        throw new Error("Review clips require mono or stereo 16-bit/24-bit PCM WAV at 44.1 kHz.");
      }

      format = {
        container: "WAV",
        codec: "PCM",
        sampleRateHz,
        bitDepth,
        channels
      };
    } else if (chunkId === "data") {
      dataStart = chunkStart;
      dataBytes = chunkSize;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (format === undefined || dataStart === undefined || dataBytes === undefined) {
    throw new Error("Review clips require fmt and data WAV chunks.");
  }

  const bytesPerSample = format.bitDepth / 8;
  const blockAlign = format.channels * bytesPerSample;

  return {
    format,
    dataStart,
    dataBytes,
    frameCount: Math.floor(dataBytes / blockAlign),
    bytesPerSample,
    blockAlign
  };
}

function readSample(buffer: Buffer, offset: number, bitDepth: 16 | 24): number {
  return bitDepth === 16 ? buffer.readInt16LE(offset) / 32768 : buffer.readIntLE(offset, 3) / 8388608;
}

function framePeak(buffer: Buffer, wav: PcmWavData, frameIndex: number): number {
  let peak = 0;
  const frameOffset = wav.dataStart + frameIndex * wav.blockAlign;

  for (let channel = 0; channel < wav.format.channels; channel += 1) {
    const sampleOffset = frameOffset + channel * wav.bytesPerSample;
    peak = Math.max(peak, Math.abs(readSample(buffer, sampleOffset, wav.format.bitDepth)));
  }

  return peak;
}

function firstAudibleFrame(buffer: Buffer, wav: PcmWavData, silenceThreshold: number): number | undefined {
  for (let frame = 0; frame < wav.frameCount; frame += 1) {
    if (framePeak(buffer, wav, frame) >= silenceThreshold) {
      return frame;
    }
  }

  return undefined;
}

function wavHeader(format: AudioFormat, dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = format.channels * (format.bitDepth / 8);
  const byteRate = format.sampleRateHz * blockAlign;

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(format.bitDepth, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);

  return header;
}

export function createNonSilentReviewClip(buffer: Buffer, options: ReviewClipOptions = {}): ReviewClipResult {
  const wav = parsePcmWavData(buffer);
  const durationSeconds = options.durationSeconds ?? 5;
  const preRollSeconds = options.preRollSeconds ?? 0.25;
  const silenceThreshold = options.silenceThreshold ?? 0.003;
  const requestedFrames = Math.max(1, Math.round(durationSeconds * wav.format.sampleRateHz));
  const clipFrames = Math.min(wav.frameCount, requestedFrames);
  const audibleFrame = firstAudibleFrame(buffer, wav, silenceThreshold);
  const maxStartFrame = Math.max(0, wav.frameCount - clipFrames);
  const preRollFrames = Math.round(preRollSeconds * wav.format.sampleRateHz);
  const startFrame = audibleFrame === undefined ? 0 : Math.min(Math.max(0, audibleFrame - preRollFrames), maxStartFrame);
  const clipDataBytes = clipFrames * wav.blockAlign;
  const sourceStart = wav.dataStart + startFrame * wav.blockAlign;
  const data = buffer.subarray(sourceStart, sourceStart + clipDataBytes);

  return {
    bytes: Buffer.concat([wavHeader(wav.format, data.length), data]),
    startSeconds: startFrame / wav.format.sampleRateHz,
    durationSeconds: clipFrames / wav.format.sampleRateHz,
    containsAudio: audibleFrame !== undefined
  };
}

export function createFullStemReviewAudio(buffer: Buffer, options: Pick<ReviewClipOptions, "silenceThreshold"> = {}): ReviewClipResult {
  const wav = parsePcmWavData(buffer);
  const silenceThreshold = options.silenceThreshold ?? 0.003;
  const audibleFrame = firstAudibleFrame(buffer, wav, silenceThreshold);
  const data = buffer.subarray(wav.dataStart, wav.dataStart + wav.dataBytes);

  return {
    bytes: Buffer.concat([wavHeader(wav.format, data.length), data]),
    startSeconds: 0,
    durationSeconds: wav.frameCount / wav.format.sampleRateHz,
    containsAudio: audibleFrame !== undefined
  };
}

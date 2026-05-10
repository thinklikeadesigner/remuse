export type SessionPreviewTrack = {
  trackId: string;
  midiProgram?: number;
  isPercussion?: boolean;
};

export type RenderSessionPreviewBounceInput = {
  tracks: SessionPreviewTrack[];
  durationSeconds?: number;
};

const sampleRateHz = 44100;
const channels = 2;
const bitDepth = 16;

function writePcm16Header(buffer: Buffer, dataBytes: number): void {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRateHz * blockAlign;

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
}

function writeSample16(buffer: Buffer, offset: number, value: number): void {
  const clipped = Math.max(-1, Math.min(1, value));
  const sample = Math.max(-32768, Math.min(32767, Math.round(clipped * 32767)));
  buffer.writeInt16LE(sample, offset);
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function trackFrequency(track: SessionPreviewTrack): number {
  const program = track.midiProgram ?? 1 + (hashString(track.trackId) % 88);
  return 110 * 2 ** ((program % 36) / 12);
}

function envelope(frame: number, totalFrames: number): number {
  const attackFrames = Math.round(sampleRateHz * 0.02);
  const releaseStart = Math.max(0, totalFrames - Math.round(sampleRateHz * 0.08));
  if (frame < attackFrames) {
    return frame / attackFrames;
  }

  if (frame > releaseStart) {
    return Math.max(0, (totalFrames - frame) / Math.max(1, totalFrames - releaseStart));
  }

  return 1;
}

function percussionSample(track: SessionPreviewTrack, frame: number): number {
  const beatFrames = Math.round(sampleRateHz * 0.5);
  const beatPosition = frame % beatFrames;
  const decay = Math.exp(-beatPosition / (sampleRateHz * 0.035));
  const hash = hashString(track.trackId);
  const sign = ((frame * 1103515245 + hash) >>> 30) % 2 === 0 ? 1 : -1;
  return sign * decay;
}

function tonalSample(track: SessionPreviewTrack, frame: number): number {
  const frequency = trackFrequency(track);
  const phase = (hashString(track.trackId) % 360) * (Math.PI / 180);
  const time = frame / sampleRateHz;
  return Math.sin(time * frequency * Math.PI * 2 + phase);
}

export function renderSessionPreviewBounceWav(input: RenderSessionPreviewBounceInput): Buffer {
  const durationSeconds = input.durationSeconds ?? 4;
  const frames = Math.max(1, Math.round(durationSeconds * sampleRateHz));
  const dataBytes = frames * channels * (bitDepth / 8);
  const buffer = Buffer.alloc(44 + dataBytes);
  writePcm16Header(buffer, dataBytes);

  if (input.tracks.length === 0) {
    return buffer;
  }

  const gain = Math.min(0.18, 0.42 / Math.sqrt(input.tracks.length));

  for (let frame = 0; frame < frames; frame += 1) {
    let left = 0;
    let right = 0;
    const frameEnvelope = envelope(frame, frames);

    input.tracks.forEach((track, index) => {
      const mono = (track.isPercussion === true ? percussionSample(track, frame) : tonalSample(track, frame)) * gain * frameEnvelope;
      const pan = input.tracks.length === 1 ? 0 : (index / (input.tracks.length - 1)) * 2 - 1;
      const leftGain = Math.cos(((pan + 1) * Math.PI) / 4);
      const rightGain = Math.sin(((pan + 1) * Math.PI) / 4);
      left += mono * leftGain;
      right += mono * rightGain;
    });

    const offset = 44 + frame * channels * 2;
    writeSample16(buffer, offset, left);
    writeSample16(buffer, offset + 2, right);
  }

  return buffer;
}

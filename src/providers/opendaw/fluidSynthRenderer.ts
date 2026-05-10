import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { SampleLibraryAssignment } from "../../pipeline/types.ts";

const execFileAsync = promisify(execFile);

export type FluidSynthTrackInput = {
  trackIndex: number;
  trackName: string;
  midiUri: string;
  sampleLibrary: SampleLibraryAssignment;
};

export type FluidSynthRenderOptions = {
  command?: string;
  soundfontPath: string;
  workingDir: string;
  timeoutMs?: number;
};

export type FluidSynthRenderResult = {
  bytes: Buffer;
  metadata: Record<string, string | number | boolean>;
};

type ParsedMidiEvent = {
  tick: number;
  bytes: number[];
  metaType?: number;
};

type ParsedMidiFile = {
  division: number;
  tempoEvents: ParsedMidiEvent[];
  channelEvents: ParsedMidiEvent[];
};

type Cursor = {
  offset: number;
};

const defaultCommand = "fluidsynth";
const defaultTimeoutMs = 5 * 60 * 1000;
const defaultTempoEvent = [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
const melodicChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

function readAscii(bytes: Buffer, offset: number, length: number): string {
  return bytes.toString("ascii", offset, offset + length);
}

function readUint16(bytes: Buffer, offset: number): number {
  return bytes.readUInt16BE(offset);
}

function readUint32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32BE(offset);
}

function readVariableLength(bytes: Buffer, cursor: Cursor): number {
  let value = 0;
  let current = 0;

  do {
    current = bytes[cursor.offset] ?? 0;
    cursor.offset += 1;
    value = (value << 7) | (current & 0x7f);
  } while ((current & 0x80) !== 0);

  return value;
}

function writeVariableLength(target: number[], value: number): void {
  let buffer = value & 0x7f;
  let remaining = value;

  while ((remaining >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (remaining & 0x7f) | 0x80;
  }

  for (;;) {
    target.push(buffer & 0xff);
    if ((buffer & 0x80) === 0) {
      break;
    }
    buffer >>= 8;
  }
}

function writeAscii(target: number[], value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target.push(value.charCodeAt(index));
  }
}

function writeUint16(target: number[], value: number): void {
  target.push((value >> 8) & 0xff, value & 0xff);
}

function writeUint32(target: number[], value: number): void {
  target.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

function metaEvent(metaType: number, data: Buffer | Uint8Array): number[] {
  const bytes = [0xff, metaType];
  writeVariableLength(bytes, data.length);
  bytes.push(...data);
  return bytes;
}

function trackNameEvent(name: string): number[] {
  return metaEvent(0x03, Buffer.from(name, "utf8"));
}

function parseMidiFile(bytes: Buffer): ParsedMidiFile {
  if (readAscii(bytes, 0, 4) !== "MThd") {
    throw new Error("MIDI header chunk is missing.");
  }

  const headerLength = readUint32(bytes, 4);
  const trackCount = readUint16(bytes, 10);
  const division = readUint16(bytes, 12);
  if ((division & 0x8000) !== 0) {
    throw new Error("SMPTE MIDI time division is not supported by the FluidSynth renderer yet.");
  }

  const tempoEvents: ParsedMidiEvent[] = [];
  const channelEvents: ParsedMidiEvent[] = [];
  let offset = 8 + headerLength;

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (readAscii(bytes, offset, 4) !== "MTrk") {
      throw new Error("MIDI track chunk is missing.");
    }

    const trackLength = readUint32(bytes, offset + 4);
    const trackEnd = offset + 8 + trackLength;
    const cursor: Cursor = { offset: offset + 8 };
    let tick = 0;
    let runningStatus: number | undefined;

    while (cursor.offset < trackEnd) {
      tick += readVariableLength(bytes, cursor);
      let status = bytes[cursor.offset];
      if (status === undefined) {
        throw new Error("Unexpected end of MIDI track.");
      }

      if (status >= 0x80) {
        cursor.offset += 1;
        runningStatus = status;
      } else if (runningStatus !== undefined) {
        status = runningStatus;
      } else {
        throw new Error("MIDI running status appeared before an explicit status byte.");
      }

      if (status === 0xff) {
        const metaType = bytes[cursor.offset];
        if (metaType === undefined) {
          throw new Error("Unexpected end of MIDI meta event.");
        }
        cursor.offset += 1;
        const length = readVariableLength(bytes, cursor);
        const data = bytes.subarray(cursor.offset, cursor.offset + length);
        cursor.offset += length;

        if (metaType === 0x51) {
          tempoEvents.push({ tick, bytes: metaEvent(metaType, data), metaType });
        }
        if (metaType === 0x2f) {
          break;
        }
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const length = readVariableLength(bytes, cursor);
        cursor.offset += length;
        continue;
      }

      const eventType = status & 0xf0;
      const dataLength = eventType === 0xc0 || eventType === 0xd0 ? 1 : 2;
      const data = Array.from(bytes.subarray(cursor.offset, cursor.offset + dataLength));
      cursor.offset += dataLength;

      if (eventType !== 0xc0) {
        channelEvents.push({ tick, bytes: [status, ...data] });
      }
    }

    offset = trackEnd;
  }

  return { division, tempoEvents, channelEvents };
}

function convertTick(tick: number, sourceDivision: number, targetDivision: number): number {
  return Math.round((tick * targetDivision) / sourceDivision);
}

function channelForTrack(track: FluidSynthTrackInput, melodicIndex: number): number {
  if (track.sampleLibrary.isPercussion === true) {
    return 9;
  }

  return melodicChannels[melodicIndex % melodicChannels.length] ?? 0;
}

function rewriteChannelEvent(bytes: number[], channel: number): number[] | undefined {
  const status = bytes[0];
  if (status === undefined) {
    return undefined;
  }

  const eventType = status & 0xf0;
  if (eventType === 0xc0) {
    return undefined;
  }

  return [(eventType | channel) & 0xff, ...bytes.slice(1)];
}

function encodeTrack(events: ParsedMidiEvent[]): Buffer {
  const sorted = events.slice().sort((a, b) => a.tick - b.tick);
  const bytes: number[] = [];
  let lastTick = 0;

  for (const event of sorted) {
    const tick = Math.max(0, Math.round(event.tick));
    writeVariableLength(bytes, tick - lastTick);
    bytes.push(...event.bytes);
    lastTick = tick;
  }

  writeVariableLength(bytes, 0);
  bytes.push(0xff, 0x2f, 0x00);
  return Buffer.from(bytes);
}

function encodeStandardMidiFile(division: number, tracks: Buffer[]): Buffer {
  const bytes: number[] = [];
  writeAscii(bytes, "MThd");
  writeUint32(bytes, 6);
  writeUint16(bytes, 1);
  writeUint16(bytes, tracks.length);
  writeUint16(bytes, division);

  for (const track of tracks) {
    writeAscii(bytes, "MTrk");
    writeUint32(bytes, track.length);
    bytes.push(...track);
  }

  return Buffer.from(bytes);
}

async function midiPathFromUri(uri: string): Promise<string> {
  const url = new URL(uri);
  if (url.protocol !== "file:") {
    throw new Error(`FluidSynth renderer requires file-backed MIDI artifacts, received ${uri}.`);
  }

  const path = fileURLToPath(url);
  await stat(path);
  return path;
}

async function buildMergedMidi(tracks: FluidSynthTrackInput[]): Promise<Buffer> {
  if (tracks.length === 0) {
    throw new Error("Cannot render an empty MIDI session with FluidSynth.");
  }

  const parsedInputs: Array<{ track: FluidSynthTrackInput; parsed: ParsedMidiFile }> = [];
  for (const track of tracks) {
    const midiPath = await midiPathFromUri(track.midiUri);
    parsedInputs.push({
      track,
      parsed: parseMidiFile(await readFile(midiPath))
    });
  }

  const targetDivision = parsedInputs[0]?.parsed.division ?? 480;
  let melodicIndex = 0;
  const outputTracks: Buffer[] = [];
  const firstTempoEvents = parsedInputs[0]?.parsed.tempoEvents ?? [];
  outputTracks.push(encodeTrack(firstTempoEvents.length === 0 ? [{ tick: 0, bytes: defaultTempoEvent }] : firstTempoEvents));

  for (const { track, parsed } of parsedInputs) {
    const channel = channelForTrack(track, melodicIndex);
    if (channel !== 9) {
      melodicIndex += 1;
    }

    const events: ParsedMidiEvent[] = [{ tick: 0, bytes: trackNameEvent(track.trackName) }];
    const program = track.sampleLibrary.midiProgram;
    if (program !== undefined) {
      events.push({
        tick: 0,
        bytes: [0xc0 | channel, Math.max(0, Math.min(127, program - 1))]
      });
    }

    for (const event of parsed.channelEvents) {
      const rewritten = rewriteChannelEvent(event.bytes, channel);
      if (rewritten !== undefined) {
        events.push({
          tick: convertTick(event.tick, parsed.division, targetDivision),
          bytes: rewritten
        });
      }
    }

    outputTracks.push(encodeTrack(events));
  }

  return encodeStandardMidiFile(targetDivision, outputTracks);
}

export async function renderFluidSynthBounce(input: {
  sessionId: string;
  tracks: FluidSynthTrackInput[];
  options: FluidSynthRenderOptions;
}): Promise<FluidSynthRenderResult> {
  await stat(input.options.soundfontPath);
  await mkdir(input.options.workingDir, { recursive: true });

  const mergedMidiPath = join(input.options.workingDir, `${input.sessionId}.fluidsynth-render.mid`);
  const outputWavPath = join(input.options.workingDir, `${input.sessionId}.fluidsynth-render.wav`);
  const mergedMidi = await buildMergedMidi(input.tracks);
  await writeFile(mergedMidiPath, mergedMidi);

  const command = input.options.command ?? defaultCommand;
  const args = [
    "-ni",
    "-F",
    outputWavPath,
    "-T",
    "wav",
    "-O",
    "s16",
    "-r",
    "44100",
    input.options.soundfontPath,
    mergedMidiPath
  ];

  try {
    await execFileAsync(command, args, {
      timeout: input.options.timeoutMs ?? defaultTimeoutMs,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`FluidSynth render failed: ${reason}`);
  }

  const bytes = await readFile(outputWavPath);
  return {
    bytes,
    metadata: {
      renderer: "libfluidsynth",
      renderMode: "fluidsynth",
      fluidsynthCommand: command,
      soundfontFilename: basename(input.options.soundfontPath),
      mergedMidiFilename: basename(mergedMidiPath),
      trackCount: input.tracks.length
    }
  };
}

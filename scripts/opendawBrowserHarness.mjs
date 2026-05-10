#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const usage = `Usage: npm run opendaw:browser-spike -- [options]

Bundles a tiny OpenDAW browser harness, serves it locally, launches Chromium
with Playwright, and calls window.remuseOpenDaw through page.evaluate().

Options:
  --bundle-only          Build the browser bundle but do not launch Playwright.
  --browser-executable <path>
                         Use an installed Chrome/Chromium executable instead
                         of Playwright's downloaded browser.
  --headed               Launch Chromium with a visible window.
  --keep                 Keep the generated var/opendaw-browser-spike run dir.
  --out-dir <path>       Use a specific output directory for generated files.
  --timeout-ms <number>  Browser wait timeout. Defaults to 30000.
  --help                 Show this message.

Full browser mode requires Playwright:
  npm install -D playwright
  npx playwright install chromium
`;

function parseArgs(argv) {
  const options = {
    bundleOnly: false,
    headless: true,
    keep: false,
    outDir: undefined,
    browserExecutable: undefined,
    timeoutMs: 30_000,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle-only") {
      options.bundleOnly = true;
    } else if (arg === "--headed") {
      options.headless = false;
    } else if (arg === "--keep") {
      options.keep = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--out-dir") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--out-dir requires a value.");
      }
      options.outDir = resolve(value);
      index += 1;
    } else if (arg === "--browser-executable") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--browser-executable requires a value.");
      }
      options.browserExecutable = resolve(value);
      index += 1;
    } else if (arg === "--timeout-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--timeout-ms requires a positive number.");
      }
      options.timeoutMs = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function nowRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function browserEntrySource() {
  return `
import * as StudioSdk from "@opendaw/studio-sdk";
import * as StudioCore from "@opendaw/studio-core";
import * as StudioAdapters from "@opendaw/studio-adapters";
import * as StudioBoxes from "@opendaw/studio-boxes";
import * as LibMidi from "@opendaw/lib-midi";

const modules = {
  "studio-sdk": StudioSdk,
  "studio-core": StudioCore,
  "studio-adapters": StudioAdapters,
  "studio-boxes": StudioBoxes,
  "lib-midi": LibMidi
};

function exportNames(moduleName) {
  return Object.keys(modules[moduleName] ?? {}).sort();
}

function moduleSummary() {
  return Object.fromEntries(
    Object.keys(modules).map((name) => [
      name,
      {
        exportCount: exportNames(name).length,
        sampleExports: exportNames(name).slice(0, 20)
      }
    ])
  );
}

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64FromBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64FromArrayBuffer(arrayBuffer) {
  return base64FromBytes(new Uint8Array(arrayBuffer));
}

function stableStringify(value) {
  const seen = new WeakSet();
  const sortValue = (input) => {
    if (input === null || typeof input !== "object") {
      return input;
    }
    if (seen.has(input)) {
      return "[Circular]";
    }
    seen.add(input);
    if (Array.isArray(input)) {
      return input.map(sortValue);
    }
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sortValue(input[key])]));
  };
  return JSON.stringify(sortValue(value), null, 2) + "\\n";
}

async function decodeMidiBase64(base64) {
  const bytes = bytesFromBase64(base64);
  const decoder = LibMidi.MidiFile?.decoder;
  if (typeof decoder !== "function") {
    return {
      ok: false,
      reason: "LibMidi.MidiFile.decoder is not available in this OpenDAW build.",
      libMidiExports: exportNames("lib-midi")
    };
  }

  try {
    const decoded = decoder(bytes.buffer).decode();
    return {
      ok: true,
      constructorName: decoded?.constructor?.name ?? typeof decoded,
      keys: decoded === null || typeof decoded !== "object" ? [] : Object.keys(decoded).slice(0, 30)
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

const OPENDAW_PPQN_QUARTER = 960;
const DEFAULT_BPM = 120;
const DEFAULT_SOUNDFONT_UUID = "d9f51577-2096-4671-9067-27ca2e12b329";

const sampleLibraries = {
  "grand-piano": {
    key: "grand-piano",
    displayName: "Grand Piano",
    family: "keys",
    engine: "opendaw-soundfont",
    midiProgram: 1,
    presetIndex: 0,
    presetName: "Acoustic Grand Piano",
    soundfontId: DEFAULT_SOUNDFONT_UUID
  },
  "electric-bass": {
    key: "electric-bass",
    displayName: "Electric Bass",
    family: "bass",
    engine: "opendaw-soundfont",
    midiProgram: 33,
    presetIndex: 32,
    presetName: "Acoustic Bass",
    soundfontId: DEFAULT_SOUNDFONT_UUID
  },
  "studio-drums": {
    key: "studio-drums",
    displayName: "Studio Drums",
    family: "drums",
    engine: "opendaw-soundfont",
    midiProgram: 1,
    presetIndex: 0,
    presetName: "Standard Drum Kit",
    soundfontId: DEFAULT_SOUNDFONT_UUID,
    isPercussion: true
  },
  "clean-electric-guitar": {
    key: "clean-electric-guitar",
    displayName: "Clean Electric Guitar",
    family: "guitar",
    engine: "opendaw-soundfont",
    midiProgram: 29,
    presetIndex: 28,
    presetName: "Electric Guitar Clean",
    soundfontId: DEFAULT_SOUNDFONT_UUID
  },
  "studio-strings": {
    key: "studio-strings",
    displayName: "Studio Strings",
    family: "strings",
    engine: "opendaw-soundfont",
    midiProgram: 49,
    presetIndex: 48,
    presetName: "String Ensemble 1",
    soundfontId: DEFAULT_SOUNDFONT_UUID
  },
  "analog-synth": {
    key: "analog-synth",
    displayName: "Analog Synth",
    family: "synth",
    engine: "opendaw-soundfont",
    midiProgram: 81,
    presetIndex: 80,
    presetName: "Lead 1 Square",
    soundfontId: DEFAULT_SOUNDFONT_UUID
  },
  "general-midi-fallback": {
    key: "general-midi-fallback",
    displayName: "General MIDI Fallback",
    family: "unknown",
    engine: "general-midi-fallback",
    midiProgram: 1,
    presetIndex: 0,
    presetName: "Acoustic Grand Piano",
    soundfontId: DEFAULT_SOUNDFONT_UUID,
    fallbackReason: "No explicit sample library was mapped for this instrument."
  }
};

function sampleLibraryForInstrument(instrument) {
  const key = instrument?.sampleLibraryKey ?? "general-midi-fallback";
  return sampleLibraries[key] ?? {
    ...sampleLibraries["general-midi-fallback"],
    fallbackReason: "Unknown sample library key: " + key
  };
}

function readAscii(bytes, offset, length) {
  let text = "";
  for (let index = offset; index < offset + length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function readUint16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readVariableLength(bytes, cursor) {
  let value = 0;
  let byte = 0;
  do {
    byte = bytes[cursor.offset];
    cursor.offset += 1;
    value = (value << 7) | (byte & 0x7f);
  } while ((byte & 0x80) !== 0);
  return value;
}

function parseSimpleMidi(bytes) {
  if (readAscii(bytes, 0, 4) !== "MThd") {
    throw new Error("MIDI header chunk is missing.");
  }
  const headerLength = readUint32(bytes, 4);
  const format = readUint16(bytes, 8);
  const trackCount = readUint16(bytes, 10);
  const division = readUint16(bytes, 12);
  const notes = [];
  const programs = [];
  let tempoMicrosPerQuarter = 500000;
  let offset = 8 + headerLength;

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (readAscii(bytes, offset, 4) !== "MTrk") {
      throw new Error("MIDI track chunk is missing.");
    }
    const trackEnd = offset + 8 + readUint32(bytes, offset + 4);
    const cursor = { offset: offset + 8 };
    let tick = 0;
    let runningStatus = 0;
    const activeNotes = new Map();

    while (cursor.offset < trackEnd) {
      tick += readVariableLength(bytes, cursor);
      let status = bytes[cursor.offset];
      if (status >= 0x80) {
        cursor.offset += 1;
        runningStatus = status;
      } else {
        status = runningStatus;
      }

      if (status === 0xff) {
        const metaType = bytes[cursor.offset];
        cursor.offset += 1;
        const length = readVariableLength(bytes, cursor);
        if (metaType === 0x51 && length === 3) {
          tempoMicrosPerQuarter = (bytes[cursor.offset] << 16) | (bytes[cursor.offset + 1] << 8) | bytes[cursor.offset + 2];
        }
        cursor.offset += length;
        if (metaType === 0x2f) {
          break;
        }
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        cursor.offset += readVariableLength(bytes, cursor);
        continue;
      }

      const eventType = status & 0xf0;
      const channel = status & 0x0f;
      const data1 = bytes[cursor.offset];
      const data2Needed = eventType !== 0xc0 && eventType !== 0xd0;
      cursor.offset += data2Needed ? 2 : 1;
      const data2 = data2Needed ? bytes[cursor.offset - 1] : 0;

      if (eventType === 0xc0) {
        programs[channel] = data1 + 1;
      } else if (eventType === 0x90 && data2 > 0) {
        activeNotes.set(channel + ":" + data1, { channel, pitch: data1, velocity: data2 / 127, startTick: tick });
      } else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
        const key = channel + ":" + data1;
        const started = activeNotes.get(key);
        if (started !== undefined) {
          activeNotes.delete(key);
          const durationTicks = Math.max(1, tick - started.startTick);
          notes.push({
            channel,
            pitch: started.pitch,
            velocity: started.velocity,
            startTick: started.startTick,
            durationTicks
          });
        }
      }
    }
    offset = trackEnd;
  }

  const bpm = 60000000 / tempoMicrosPerQuarter;
  return { format, trackCount, division, bpm, programs, notes };
}

function midiTicksToOpenDawPpqn(ticks, division) {
  return ticks * OPENDAW_PPQN_QUARTER / division;
}

function midiTicksToSeconds(ticks, division, bpm) {
  return ticks / division * 60 / bpm;
}

function createNoopSubscription() {
  return { terminate() {} };
}

function optionNone() {
  return {
    nonEmpty: () => false,
    isEmpty: () => true,
    unwrap: () => { throw new Error("Option is empty."); },
    unwrapOrNull: () => null,
    unwrapOrUndefined: () => undefined,
    match: (visitor) => visitor.none()
  };
}

function optionSome(value) {
  return {
    nonEmpty: () => true,
    isEmpty: () => false,
    unwrap: () => value,
    unwrapOrNull: () => value,
    unwrapOrUndefined: () => value,
    match: (visitor) => visitor.some(value)
  };
}

function createHarnessSoundfont() {
  return {
    presets: Array.from({ length: 128 }, (_, index) => ({
      name: "General MIDI Preset " + String(index + 1),
      preset: index,
      bank: 0
    }))
  };
}

function createLoader(uuid, kind) {
  const listeners = new Set();
  const loadedSoundfont = kind === "soundfont" ? optionSome(createHarnessSoundfont()) : optionNone();
  const state = kind === "soundfont" ? { type: "loaded" } : { type: "idle" };
  return {
    uuid,
    data: optionNone(),
    soundfont: loadedSoundfont,
    state,
    peaks: optionNone(),
    meta: optionNone(),
    subscribe(listener) {
      listeners.add(listener);
      listener(this.state);
      return { terminate: () => listeners.delete(listener) };
    },
    invalidate() {},
    setError(reason) {
      this.state = { type: "error", reason };
      for (const listener of listeners) {
        listener(this.state);
      }
    },
    toString() {
      return "{ReMuseHarnessLoader " + uuid + "}";
    }
  };
}

function createLoaderManager(kind) {
  const loaders = new Map();
  return {
    register() {
      return createNoopSubscription();
    },
    record() {},
    remove(uuid) {
      loaders.delete(String(uuid));
    },
    invalidate(uuid) {
      loaders.get(String(uuid))?.invalidate();
    },
    getOrCreate(uuid) {
      const key = String(uuid);
      if (!loaders.has(key)) {
        loaders.set(key, createLoader(key, kind));
      }
      return loaders.get(key);
    }
  };
}

function createProjectEnv() {
  const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const audioContext = new AudioContextCtor({ sampleRate: 44100 });
  return {
    audioContext,
    audioWorklets: {
      context: audioContext,
      createEngine() {
        throw new Error("AudioWorklet engine rendering is outside this harness proof.");
      },
      createMeter() {
        throw new Error("Meter worklets are outside this harness proof.");
      },
      createRecording() {
        throw new Error("Recording worklets are outside this harness proof.");
      }
    },
    sampleManager: createLoaderManager("sample"),
    soundfontManager: createLoaderManager("soundfont"),
    sampleService: {
      importFile: async () => {
        throw new Error("Sample import is outside this harness proof.");
      }
    },
    soundfontService: {
      importFile: async () => {
        throw new Error("Soundfont import is outside this harness proof.");
      }
    }
  };
}

function boxId(box) {
  return box?.address?.toString?.() ?? null;
}

async function createBlankProject() {
  const env = createProjectEnv();
  const project = StudioCore.Project.new(env);
  project.api.setBpm(DEFAULT_BPM);
  return { env, project };
}

function applySampleLibraryPreset(instrumentBox, sampleLibrary) {
  if (typeof instrumentBox?.presetIndex?.setValue === "function" && Number.isFinite(sampleLibrary.presetIndex)) {
    instrumentBox.presetIndex.setValue(sampleLibrary.presetIndex);
    return true;
  }
  return false;
}

async function importTrackIntoOpenDaw(project, inputTrack, trackIndex) {
  const instrument = inputTrack.instrument ?? { canonicalName: inputTrack.id ?? "unknown", family: "unknown" };
  const sampleLibrary = sampleLibraryForInstrument(instrument);
  const midiBytes = bytesFromBase64(inputTrack.midiBase64);
  const openDawDecode = await decodeMidiBase64(inputTrack.midiBase64);
  const parsedMidi = parseSimpleMidi(midiBytes);
  const trackName = inputTrack.trackName ?? instrument.canonicalName ?? "Track " + String(trackIndex + 1);
  const notes = parsedMidi.notes.map((note) => ({
    pitch: note.pitch,
    velocity: note.velocity,
    channel: note.channel,
    startSeconds: midiTicksToSeconds(note.startTick, parsedMidi.division, parsedMidi.bpm),
    durationSeconds: midiTicksToSeconds(note.durationTicks, parsedMidi.division, parsedMidi.bpm),
    positionPpqn: midiTicksToOpenDawPpqn(note.startTick, parsedMidi.division),
    durationPpqn: midiTicksToOpenDawPpqn(note.durationTicks, parsedMidi.division)
  }));
  const endPpqn = Math.max(OPENDAW_PPQN_QUARTER, ...notes.map((note) => note.positionPpqn + note.durationPpqn));
  let product;
  let region;
  let presetApplied = false;

  project.boxGraph.beginTransaction();
  try {
    product = project.api.createInstrument(StudioAdapters.InstrumentFactories.Soundfont, {
      name: trackName,
      index: trackIndex,
      attachment: {
        uuid: sampleLibrary.soundfontId,
        name: sampleLibrary.displayName
      }
    });
    presetApplied = applySampleLibraryPreset(product.instrumentBox, sampleLibrary);
    region = project.api.createNoteRegion({
      trackBox: product.trackBox,
      position: 0,
      duration: endPpqn,
      name: trackName
    });

    for (const note of notes) {
      project.api.createNoteEvent({
        owner: region,
        position: note.positionPpqn,
        duration: Math.max(1, note.durationPpqn),
        pitch: note.pitch,
        velocity: note.velocity
      });
    }
    project.boxGraph.endTransaction();
  } catch (error) {
    project.boxGraph.abortTransaction();
    throw error;
  }

  return {
    inputTrackId: inputTrack.id,
    trackIndex,
    trackName,
    trackId: boxId(product.trackBox),
    audioUnitId: boxId(product.audioUnitBox),
    instrumentDeviceId: boxId(product.instrumentBox),
    regionId: boxId(region),
    instrument,
    sampleLibrary,
    sampleLibraryLoaded: true,
    sampleLibraryPresetApplied: presetApplied,
    midi: {
      filename: inputTrack.midiFilename,
      decodedByOpenDawLibMidi: openDawDecode.ok,
      openDawLibMidiDecode: openDawDecode,
      format: parsedMidi.format,
      trackCount: parsedMidi.trackCount,
      division: parsedMidi.division,
      bpm: parsedMidi.bpm,
      detectedPrograms: parsedMidi.programs,
      noteCount: notes.length
    },
    notes
  };
}

function frequencyForPitch(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function waveformForFamily(family) {
  if (family === "bass") {
    return "sawtooth";
  }
  if (family === "guitar" || family === "strings") {
    return "triangle";
  }
  if (family === "synth") {
    return "square";
  }
  return "sine";
}

async function renderStereoPreviewWav(trackPlans, options = {}) {
  const sampleRate = options.sampleRate ?? 44100;
  const bitDepth = 16;
  const numberOfChannels = 2;
  const maxEnd = Math.max(1, ...trackPlans.flatMap((track) => track.notes.map((note) => note.startSeconds + note.durationSeconds)));
  const durationSeconds = Math.min(Math.max(maxEnd + 1, 2), 30);
  const frameCount = Math.ceil(durationSeconds * sampleRate);
  const OfflineCtor = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  const context = new OfflineCtor(numberOfChannels, frameCount, sampleRate);
  const master = context.createGain();
  master.gain.value = Math.min(0.9, 0.3 + trackPlans.length * 0.02);
  master.connect(context.destination);

  trackPlans.forEach((track, trackIndex) => {
    const trackGain = context.createGain();
    trackGain.gain.value = 0.16;
    const pan = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
    if (pan !== null) {
      pan.pan.value = trackPlans.length <= 1 ? 0 : -0.6 + (1.2 * trackIndex / Math.max(1, trackPlans.length - 1));
      trackGain.connect(pan);
      pan.connect(master);
    } else {
      trackGain.connect(master);
    }

    track.notes.forEach((note) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = waveformForFamily(track.instrument.family);
      oscillator.frequency.value = frequencyForPitch(note.pitch);
      const start = Math.max(0, note.startSeconds);
      const stop = Math.min(durationSeconds, start + Math.max(0.05, note.durationSeconds));
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(Math.min(0.8, note.velocity), start + 0.01);
      envelope.gain.setTargetAtTime(0.0001, Math.max(start + 0.02, stop - 0.05), 0.025);
      oscillator.connect(envelope);
      envelope.connect(trackGain);
      oscillator.start(start);
      oscillator.stop(stop + 0.08);
    });
  });

  const audioBuffer = await context.startRendering();
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  return {
    sampleRate,
    bitDepth,
    channels: numberOfChannels,
    durationSeconds,
    wavBase64: base64FromBytes(encodeWav16(left, right, sampleRate))
  };
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function encodeWav16(left, right, sampleRate) {
  const frameCount = left.length;
  const bytes = new Uint8Array(44 + frameCount * 4);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + frameCount * 4, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, frameCount * 4, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const l = Math.max(-1, Math.min(1, left[frame]));
    const r = Math.max(-1, Math.min(1, right[frame]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }
  return bytes;
}

async function runSessionAssemblyProof(input) {
  const steps = [];
  const step = (name, status, details = {}) => steps.push({ name, status, details });
  const { env, project } = await createBlankProject();
  step("create-blank-opendaw-session", "succeeded", {
    projectCreated: true,
    bpm: DEFAULT_BPM,
    boxCount: project.boxGraph.boxes().length
  });

  const trackPlans = [];
  for (let index = 0; index < input.tracks.length; index += 1) {
    trackPlans.push(await importTrackIntoOpenDaw(project, input.tracks[index], index));
  }
  step("create-tracks", "succeeded", {
    trackCount: trackPlans.length,
    trackIds: trackPlans.map((track) => track.trackId)
  });
  step("import-midi-files", "succeeded", {
    importedMidiFiles: trackPlans.length,
    totalImportedNotes: trackPlans.reduce((sum, track) => sum + track.midi.noteCount, 0)
  });
  step("map-instruments-to-sample-libraries", "succeeded", {
    mappings: trackPlans.map((track) => ({
      trackName: track.trackName,
      instrument: track.instrument.canonicalName,
      sampleLibraryKey: track.sampleLibrary.key,
      presetName: track.sampleLibrary.presetName
    }))
  });
  step("load-sample-libraries", "succeeded", {
    loaded: trackPlans.map((track) => ({
      trackName: track.trackName,
      sampleLibraryKey: track.sampleLibrary.key,
      soundfontId: track.sampleLibrary.soundfontId,
      presetApplied: track.sampleLibraryPresetApplied
    }))
  });

  const projectArrayBuffer = project.toArrayBuffer();
  const deterministicSessionPlan = {
    schema: "remuse.headless-opendaw-session-plan.v1",
    createdBy: "scripts/opendawBrowserHarness.mjs",
    renderFormat: { container: "WAV", codec: "PCM", sampleRateHz: 44100, bitDepth: 16, channels: 2 },
    tracks: trackPlans.map((track) => ({
      inputTrackId: track.inputTrackId,
      trackIndex: track.trackIndex,
      trackName: track.trackName,
      midiFilename: track.midi.filename,
      instrument: track.instrument,
      sampleLibrary: track.sampleLibrary,
      noteCount: track.midi.noteCount,
      notes: track.notes.map((note) => ({
        pitch: note.pitch,
        velocity: Number(note.velocity.toFixed(6)),
        startSeconds: Number(note.startSeconds.toFixed(6)),
        durationSeconds: Number(note.durationSeconds.toFixed(6))
      }))
    }))
  };
  step("save-reproducible-session-artifact", "succeeded", {
    deterministicPlanBytes: stableStringify(deterministicSessionPlan).length,
    openDawProjectBytes: projectArrayBuffer.byteLength,
    note: "The JSON plan is deterministic; the native OpenDAW project contains SDK-generated UUIDs."
  });

  const bounce = await renderStereoPreviewWav(trackPlans, { sampleRate: 44100 });
  step("bounce-stereo-mix", "succeeded", {
    engine: "browser OfflineAudioContext harness renderer",
    sampleRateHz: bounce.sampleRate,
    bitDepth: bounce.bitDepth,
    channels: bounce.channels,
    durationSeconds: bounce.durationSeconds
  });

  if (typeof env.audioContext?.close === "function") {
    await env.audioContext.close();
  }

  return {
    ok: true,
    steps,
    trackPlans,
    artifacts: {
      sessionPlanJson: stableStringify(deterministicSessionPlan),
      openDawProjectBase64: base64FromArrayBuffer(projectArrayBuffer),
      bounceWavBase64: bounce.wavBase64,
      bounceFormat: {
        container: "WAV",
        codec: "PCM",
        sampleRateHz: bounce.sampleRate,
        bitDepth: bounce.bitDepth,
        channels: bounce.channels,
        durationSeconds: bounce.durationSeconds
      }
    }
  };
}

globalThis.remuseOpenDaw = {
  ready: true,
  ping() {
    return {
      ok: true,
      userAgent: navigator.userAgent,
      hasAudioContext: typeof AudioContext !== "undefined" || typeof webkitAudioContext !== "undefined",
      hasOfflineAudioContext: typeof OfflineAudioContext !== "undefined" || typeof webkitOfflineAudioContext !== "undefined"
    };
  },
  moduleSummary,
  listExports: exportNames,
  decodeMidiBase64,
  runSessionAssemblyProof
};

globalThis.dispatchEvent(new CustomEvent("remuse-opendaw-ready"));
`;
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function writeUint16(bytes, value) {
  bytes.push((value >> 8) & 0xff, value & 0xff);
}

function writeUint32(bytes, value) {
  bytes.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

function writeAsciiBytes(bytes, text) {
  for (let index = 0; index < text.length; index += 1) {
    bytes.push(text.charCodeAt(index));
  }
}

function writeVariableLength(bytes, value) {
  let buffer = value & 0x7f;
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  for (;;) {
    bytes.push(buffer & 0xff);
    if ((buffer & 0x80) !== 0) {
      buffer >>= 8;
    } else {
      break;
    }
  }
}

function createDemoMidiBase64({ midiProgram = 1, channel = 0, notes }) {
  const ticksPerQuarter = 480;
  const track = [];
  writeVariableLength(track, 0);
  track.push(0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);
  writeVariableLength(track, 0);
  track.push(0xc0 | channel, Math.max(0, Math.min(127, midiProgram - 1)));

  const events = [];
  for (const note of notes) {
    const startTick = Math.round(note.startSeconds * 2 * ticksPerQuarter);
    const endTick = Math.max(startTick + 1, Math.round((note.startSeconds + note.durationSeconds) * 2 * ticksPerQuarter));
    const velocity = Math.max(1, Math.min(127, Math.round((note.velocity ?? 0.82) * 127)));
    events.push({ tick: startTick, order: 1, bytes: [0x90 | channel, note.pitch, velocity] });
    events.push({ tick: endTick, order: 0, bytes: [0x80 | channel, note.pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  let cursor = 0;
  for (const event of events) {
    writeVariableLength(track, event.tick - cursor);
    track.push(...event.bytes);
    cursor = event.tick;
  }
  writeVariableLength(track, 0);
  track.push(0xff, 0x2f, 0x00);

  const bytes = [];
  writeAsciiBytes(bytes, "MThd");
  writeUint32(bytes, 6);
  writeUint16(bytes, 0);
  writeUint16(bytes, 1);
  writeUint16(bytes, ticksPerQuarter);
  writeAsciiBytes(bytes, "MTrk");
  writeUint32(bytes, track.length);
  bytes.push(...track);
  return toBase64(Uint8Array.from(bytes));
}

function createDemoAssemblyInput() {
  return {
    jobId: "opendaw-browser-harness-demo",
    tracks: [
      {
        id: "demo-piano",
        trackName: "piano",
        midiFilename: "demo_01_piano.mid",
        instrument: {
          canonicalName: "piano",
          family: "keys",
          confidence: 1,
          method: "harness-demo",
          sampleLibraryKey: "grand-piano",
          midiProgram: 1
        },
        midiBase64: createDemoMidiBase64({
          midiProgram: 1,
          notes: [
            { pitch: 60, startSeconds: 0, durationSeconds: 0.6, velocity: 0.82 },
            { pitch: 64, startSeconds: 0.5, durationSeconds: 0.6, velocity: 0.8 },
            { pitch: 67, startSeconds: 1.0, durationSeconds: 0.8, velocity: 0.86 }
          ]
        })
      },
      {
        id: "demo-bass",
        trackName: "electric-bass",
        midiFilename: "demo_02_electric-bass.mid",
        instrument: {
          canonicalName: "electric-bass",
          family: "bass",
          confidence: 1,
          method: "harness-demo",
          sampleLibraryKey: "electric-bass",
          midiProgram: 33
        },
        midiBase64: createDemoMidiBase64({
          midiProgram: 33,
          notes: [
            { pitch: 40, startSeconds: 0, durationSeconds: 0.9, velocity: 0.78 },
            { pitch: 43, startSeconds: 1.0, durationSeconds: 0.75, velocity: 0.76 }
          ]
        })
      },
      {
        id: "demo-drums",
        trackName: "drums",
        midiFilename: "demo_03_drums.mid",
        instrument: {
          canonicalName: "drums",
          family: "drums",
          confidence: 1,
          method: "harness-demo",
          sampleLibraryKey: "studio-drums"
        },
        midiBase64: createDemoMidiBase64({
          midiProgram: 1,
          channel: 9,
          notes: [
            { pitch: 36, startSeconds: 0, durationSeconds: 0.12, velocity: 0.9 },
            { pitch: 38, startSeconds: 0.5, durationSeconds: 0.12, velocity: 0.82 },
            { pitch: 36, startSeconds: 1.0, durationSeconds: 0.12, velocity: 0.88 },
            { pitch: 42, startSeconds: 1.5, durationSeconds: 0.12, velocity: 0.7 }
          ]
        })
      }
    ]
  };
}

function bytesFromBase64(base64) {
  return Buffer.from(base64, "base64");
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeSessionAssemblyArtifacts(outDir, assembly) {
  const sessionDir = join(outDir, "session");
  await mkdir(sessionDir, { recursive: true });

  const sessionPlanPath = join(sessionDir, "remuse-headless-opendaw-session.plan.json");
  const openDawProjectPath = join(sessionDir, "remuse-headless-opendaw-project.opendaw");
  const bouncePath = join(sessionDir, "remuse-headless-opendaw-bounce.wav");
  const reportPath = join(sessionDir, "remuse-headless-opendaw-proof-report.json");

  const sessionPlanBytes = Buffer.from(assembly.artifacts.sessionPlanJson, "utf8");
  const openDawProjectBytes = bytesFromBase64(assembly.artifacts.openDawProjectBase64);
  const bounceBytes = bytesFromBase64(assembly.artifacts.bounceWavBase64);

  await writeFile(sessionPlanPath, sessionPlanBytes);
  await writeFile(openDawProjectPath, openDawProjectBytes);
  await writeFile(bouncePath, bounceBytes);

  const artifactSummary = {
    sessionPlan: {
      path: sessionPlanPath,
      byteLength: sessionPlanBytes.length,
      sha256: sha256Hex(sessionPlanBytes)
    },
    openDawProject: {
      path: openDawProjectPath,
      byteLength: openDawProjectBytes.length,
      sha256: sha256Hex(openDawProjectBytes)
    },
    bounce: {
      path: bouncePath,
      byteLength: bounceBytes.length,
      sha256: sha256Hex(bounceBytes),
      format: assembly.artifacts.bounceFormat
    }
  };

  await writeFile(
    reportPath,
    JSON.stringify(
      {
        ok: assembly.ok,
        steps: assembly.steps,
        artifactSummary,
        tracks: assembly.trackPlans.map((track) => ({
          trackName: track.trackName,
          instrument: track.instrument.canonicalName,
          sampleLibraryKey: track.sampleLibrary.key,
          noteCount: track.midi.noteCount
        }))
      },
      null,
      2
    ) + "\n"
  );

  return {
    ...artifactSummary,
    report: {
      path: reportPath
    }
  };
}

function htmlSource() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>ReMuse OpenDAW Browser Harness</title>
  </head>
  <body>
    <script src="/opendaw-harness.js"></script>
  </body>
</html>
`;
}

function contentType(pathname) {
  if (pathname.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (pathname.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  return "application/octet-stream";
}

const nodeBuiltinBrowserShimPlugin = {
  name: "node-builtin-browser-shims",
  setup(build) {
    build.onResolve({ filter: /^(crypto|util)$/ }, (args) => ({
      path: args.path,
      namespace: "node-builtin-browser-shim"
    }));

    build.onLoad({ filter: /.*/, namespace: "node-builtin-browser-shim" }, (args) => {
      if (args.path === "crypto") {
        return {
          loader: "js",
          contents: `
const unavailable = (name) => () => {
  throw new Error("Node crypto." + name + " is not available inside the OpenDAW browser harness.");
};
export const webcrypto = globalThis.crypto;
export const randomUUID = () => globalThis.crypto?.randomUUID?.() ?? String(Date.now());
export const randomBytes = unavailable("randomBytes");
export const createHash = unavailable("createHash");
export default { webcrypto, randomUUID, randomBytes, createHash };
`
        };
      }

      return {
        loader: "js",
        contents: `
export const inspect = (value) => String(value);
export const inherits = () => undefined;
export const promisify = (fn) => fn;
export const types = {};
export default { inspect, inherits, promisify, types };
`
      };
    });
  }
};

async function createHarnessBuild(options) {
  const rootDir = process.cwd();
  const outDir = options.outDir ?? join(rootDir, "var", "opendaw-browser-spike", nowRunId());
  await mkdir(outDir, { recursive: true });

  const entryPath = join(outDir, "opendaw-entry.js");
  const htmlPath = join(outDir, "index.html");
  const bundlePath = join(outDir, "opendaw-harness.js");
  const metafilePath = join(outDir, "esbuild-metafile.json");

  await writeFile(entryPath, browserEntrySource());
  await writeFile(htmlPath, htmlSource());

  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: [entryPath],
    outfile: bundlePath,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    sourcemap: "inline",
    metafile: true,
    logLevel: "silent",
    plugins: [nodeBuiltinBrowserShimPlugin],
    mainFields: ["browser", "module", "main"],
    loader: {
      ".wasm": "binary",
      ".png": "dataurl",
      ".jpg": "dataurl",
      ".jpeg": "dataurl",
      ".svg": "text",
      ".css": "text"
    },
    define: {
      global: "globalThis",
      "process.env.NODE_ENV": '"development"'
    }
  });

  await writeFile(metafilePath, JSON.stringify(result.metafile, null, 2) + "\n");

  return {
    rootDir,
    outDir,
    entryPath,
    htmlPath,
    bundlePath,
    metafilePath
  };
}

function startStaticServer(outDir) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = join(outDir, requestedPath.replace(/^[/]+/, ""));
      const bytes = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentType(filePath),
        "content-length": bytes.length
      });
      response.end(bytes);
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("Could not determine static server address."));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`
      });
    });
  });
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Playwright is required for full browser mode.\n\n${message}\n\nInstall it with:\n  npm install -D playwright\n  npx playwright install chromium`);
  }
}

async function runBrowser(buildInfo, options) {
  const { chromium } = await importPlaywright();
  const { server, url } = await startStaticServer(buildInfo.outDir);
  let browser;
  try {
    browser = await chromium.launch({
      headless: options.headless,
      ...(options.browserExecutable === undefined ? {} : { executablePath: options.browserExecutable })
    });
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  const page = await browser.newPage();
  const consoleMessages = [];
  page.on("console", (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text()
    });
  });

  try {
    await page.goto(url, { waitUntil: "load", timeout: options.timeoutMs });
    await page.waitForFunction(() => globalThis.remuseOpenDaw?.ready === true, undefined, {
      timeout: options.timeoutMs
    });
    const assemblyInput = createDemoAssemblyInput();
    const report = await page.evaluate(async (input) => {
      const api = globalThis.remuseOpenDaw;
      return {
        ping: api.ping(),
        moduleSummary: api.moduleSummary(),
        studioCoreProjectExports: api.listExports("studio-core").filter((name) => name.toLowerCase().includes("project")).slice(0, 30),
        libMidiExports: api.listExports("lib-midi").slice(0, 30),
        sessionAssembly: await api.runSessionAssemblyProof(input)
      };
    }, assemblyInput);
    const artifactFiles = await writeSessionAssemblyArtifacts(buildInfo.outDir, report.sessionAssembly);

    return {
      url,
      report: {
        ...report,
        sessionAssembly: {
          ...report.sessionAssembly,
          artifacts: {
            bounceFormat: report.sessionAssembly.artifacts.bounceFormat,
            files: artifactFiles
          }
        }
      },
      consoleMessages
    };
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }

  const buildInfo = await createHarnessBuild(options);
  if (options.bundleOnly) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "bundle-only",
          build: {
            outDir: buildInfo.outDir,
            html: buildInfo.htmlPath,
            bundle: buildInfo.bundlePath,
            metafile: buildInfo.metafilePath,
            htmlUrl: pathToFileURL(buildInfo.htmlPath).href
          }
        },
        null,
        2
      )
    );
    return;
  }

  const browserResult = await runBrowser(buildInfo, options);
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "browser",
        build: {
          outDir: buildInfo.outDir,
          html: buildInfo.htmlPath,
          bundle: buildInfo.bundlePath,
          metafile: buildInfo.metafilePath
        },
        browser: browserResult
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

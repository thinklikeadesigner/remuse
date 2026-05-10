import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderSessionPreviewBounceWav } from "../../src/audio/sessionPreviewBounce.ts";
import { parseWavFormat } from "../../src/audio/wav.ts";
import { LocalOpenDawSessionProvider } from "../../src/providers/opendaw/localSessionProvider.ts";
import { FileArtifactStore } from "../../src/storage/fileArtifactStore.ts";

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

function minimalMidi(program: number): Buffer {
  const track: number[] = [];
  writeVariableLength(track, 0);
  track.push(0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);
  writeVariableLength(track, 0);
  track.push(0xc0, program - 1);
  writeVariableLength(track, 0);
  track.push(0x90, 60, 100);
  writeVariableLength(track, 480);
  track.push(0x80, 60, 0);
  writeVariableLength(track, 0);
  track.push(0xff, 0x2f, 0x00);

  const bytes: number[] = [];
  writeAscii(bytes, "MThd");
  writeUint32(bytes, 6);
  writeUint16(bytes, 0);
  writeUint16(bytes, 1);
  writeUint16(bytes, 480);
  writeAscii(bytes, "MTrk");
  writeUint32(bytes, track.length);
  bytes.push(...track);
  return Buffer.from(bytes);
}

test("LocalOpenDawSessionProvider assembles session tracks and renders a WAV bounce", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-local-opendaw-"));
  const artifactStore = new FileArtifactStore({ rootDir });
  const provider = new LocalOpenDawSessionProvider({ artifactStore });
  const pianoMidi = await artifactStore.saveMidiArtifact({
    jobId: "job-opendaw",
    stage: "midi",
    filename: "job-opendaw_01_piano.mid",
    bytes: Buffer.from([0x4d, 0x54, 0x68, 0x64, 0x00]),
    sourceArtifactIds: ["stem-piano"],
    instrument: {
      canonicalName: "piano",
      family: "keys",
      confidence: 0.88,
      detectedFromArtifactId: "stem-piano",
      method: "provider-native",
      midiProgram: 1,
      sampleLibraryKey: "grand-piano"
    }
  });
  const fallbackMidi = await artifactStore.saveMidiArtifact({
    jobId: "job-opendaw",
    stage: "midi",
    filename: "job-opendaw_02_other.mid",
    bytes: Buffer.from([0x4d, 0x54, 0x68, 0x64, 0x01]),
    sourceArtifactIds: ["stem-other"],
    instrument: {
      canonicalName: "other",
      family: "unknown",
      confidence: 0.4,
      detectedFromArtifactId: "stem-other",
      method: "provider-native"
    }
  });
  const context = {
    jobId: "job-opendaw",
    traceId: "trace-job-opendaw",
    emit: () => undefined
  };

  const blankSession = await provider.createSession(context);
  assert.equal(blankSession.trackCount, 0);
  assert.equal(blankSession.metadata.reproducible, true);

  const assembled = await provider.importMidiTracks(blankSession, [pianoMidi.artifact, fallbackMidi.artifact], context);
  assert.equal(assembled.session.trackCount, 2);
  assert.equal(assembled.tracks[0]?.trackName, "01 piano");
  assert.equal(assembled.tracks[0]?.sampleLibraryKey, "grand-piano");
  assert.equal(assembled.tracks[0]?.sampleLibrary.presetName, "Stereo Grand");
  assert.equal(assembled.tracks[0]?.sampleLibraryLoaded, true);
  assert.equal(assembled.tracks[1]?.sampleLibraryKey, "general-midi-fallback");
  assert.match(assembled.tracks[1]?.sampleLibrary.fallbackReason ?? "", /No explicit sample library/);

  const sessionJson = JSON.parse(await readFile(fileURLToPath(assembled.session.uri), "utf8")) as {
    schemaVersion: string;
    tracks: Array<{ sampleLibraryLoaded: boolean; midi: { normalizedInstrument: string } }>;
  };
  assert.equal(sessionJson.schemaVersion, "remuse.opendaw-session.v1");
  assert.equal(sessionJson.tracks.length, 2);
  assert.equal(sessionJson.tracks[0]?.sampleLibraryLoaded, true);
  assert.equal(sessionJson.tracks[0]?.midi.normalizedInstrument, "piano");

  const bounce = await provider.bounceSession(assembled.session, context);
  const bounceBytes = await readFile(fileURLToPath(bounce.bounce.uri));
  const parsed = parseWavFormat(bounceBytes);
  assert.equal(parsed.format.sampleRateHz, 44100);
  assert.equal(parsed.format.bitDepth, 16);
  assert.equal(parsed.format.channels, 2);
  assert.equal(bounce.bounce.metadata.provider, "local-opendaw-session");
  assert.equal(bounce.bounce.metadata.renderMode, "deterministic-preview");
  assert.equal(bounce.bounce.metadata.trackCount, 2);
});

test("LocalOpenDawSessionProvider can render the bounce through FluidSynth", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-fluidsynth-opendaw-"));
  const artifactStore = new FileArtifactStore({ rootDir });
  const fakeSoundfontPath = join(rootDir, "test.sf2");
  const fakeRenderedWavPath = join(rootDir, "fake-render.wav");
  const fakeFluidSynthPath = join(rootDir, "fake-fluidsynth");
  const fakeArgsPath = join(rootDir, "fake-fluidsynth.args.txt");
  await writeFile(fakeSoundfontPath, Buffer.from("fake sf2"));
  await writeFile(
    fakeRenderedWavPath,
    renderSessionPreviewBounceWav({
      tracks: [{ trackId: "fake", midiProgram: 1 }]
    })
  );
  await writeFile(
    fakeFluidSynthPath,
    `#!/bin/sh
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-F" ]; then
    out="$arg"
  fi
  prev="$arg"
done
if [ -z "$out" ]; then
  exit 12
fi
printf '%s\\n' "$@" > "${fakeArgsPath}"
cp "${fakeRenderedWavPath}" "$out"
`
  );
  await chmod(fakeFluidSynthPath, 0o755);

  const provider = new LocalOpenDawSessionProvider({
    artifactStore,
    renderBackend: {
      mode: "fluidsynth",
      command: fakeFluidSynthPath,
      soundfontPath: fakeSoundfontPath,
      renderTrackDiagnostics: true
    }
  });
  const pianoMidi = await artifactStore.saveMidiArtifact({
    jobId: "job-fluidsynth",
    stage: "midi",
    filename: "job-fluidsynth_01_piano.mid",
    bytes: minimalMidi(1),
    sourceArtifactIds: ["stem-piano"],
    instrument: {
      canonicalName: "piano",
      family: "keys",
      confidence: 0.88,
      detectedFromArtifactId: "stem-piano",
      method: "provider-native",
      midiProgram: 1,
      sampleLibraryKey: "grand-piano"
    }
  });
  const context = {
    jobId: "job-fluidsynth",
    traceId: "trace-job-fluidsynth",
    emit: () => undefined
  };

  const blankSession = await provider.createSession(context);
  const assembled = await provider.importMidiTracks(blankSession, [pianoMidi.artifact], context);
  const bounce = await provider.bounceSession(assembled.session, context);
  const args = await readFile(fakeArgsPath, "utf8");
  const parsed = parseWavFormat(await readFile(fileURLToPath(bounce.bounce.uri)));

  assert.match(args, /-F/);
  assert.match(args, /-O\ns16/);
  assert.match(args, /-r\n44100/);
  assert.match(args, /test\.sf2/);
  assert.equal(parsed.format.sampleRateHz, 44100);
  assert.equal(parsed.format.bitDepth, 16);
  assert.equal(parsed.format.channels, 2);
  assert.equal(bounce.bounce.metadata.provider, "local-opendaw-session");
  assert.equal(bounce.bounce.metadata.renderer, "libfluidsynth");
  assert.equal(bounce.bounce.metadata.renderMode, "fluidsynth");
  assert.equal(bounce.bounce.metadata.soundfontFilename, "test.sf2");
  assert.equal(bounce.bounce.metadata.diagnosticTrackBounceCount, 1);
  assert.equal(bounce.diagnosticTrackBounces?.length, 1);
  const diagnostic = bounce.diagnosticTrackBounces?.[0];
  assert.ok(diagnostic);
  assert.equal(diagnostic.trackName, "01 piano");
  assert.equal(diagnostic.sampleLibraryKey, "grand-piano");
  assert.equal(diagnostic.bounce.kind, "diagnostic-track-bounce");
  assert.equal(diagnostic.bounce.metadata.renderMode, "fluidsynth-track-diagnostic");
  assert.equal(parseWavFormat(await readFile(fileURLToPath(diagnostic.bounce.uri))).format.bitDepth, 16);
});

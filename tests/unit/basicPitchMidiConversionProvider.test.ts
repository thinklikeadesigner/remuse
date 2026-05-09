import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inferInstrumentLabel } from "../../src/pipeline/naming.ts";
import type { InstrumentStem, PipelineStepEvent } from "../../src/pipeline/types.ts";
import {
  BasicPitchMidiConversionProvider,
  type BasicPitchCommandRunner,
  type BasicPitchCommandRunnerOptions
} from "../../src/providers/midi/basicPitchMidiConversionProvider.ts";
import { FileArtifactStore } from "../../src/storage/fileArtifactStore.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

function midiFileFixture(index: number): Buffer {
  return Buffer.from([
    0x4d,
    0x54,
    0x68,
    0x64,
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x01,
    0x00,
    0x01,
    0x01,
    0xe0,
    0x4d,
    0x54,
    0x72,
    0x6b,
    0x00,
    0x00,
    0x00,
    0x05,
    index,
    0x00,
    0xff,
    0x2f,
    0x00
  ]);
}

test("BasicPitchMidiConversionProvider runs Basic Pitch per stem and preserves normalized MIDI names", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-basic-pitch-"));
  const artifactStore = new FileArtifactStore({ rootDir });
  const bassStem = await artifactStore.saveAudioArtifact({
    jobId: "job-basic-pitch",
    stage: "instrument-stems",
    kind: "instrument-stem",
    filename: "stem-01-bass.wav",
    bytes: createPcmWavFixture({ bitDepth: 16 }),
    sourceArtifactIds: ["dry-1"],
    metadata: { provider: "mvsep" }
  });
  const drumsStem = await artifactStore.saveAudioArtifact({
    jobId: "job-basic-pitch",
    stage: "instrument-stems",
    kind: "instrument-stem",
    filename: "stem-02-drums.wav",
    bytes: createPcmWavFixture({ bitDepth: 16 }),
    sourceArtifactIds: ["dry-1"],
    metadata: { provider: "mvsep" }
  });
  const labeledStems: Array<InstrumentStem & { label: NonNullable<InstrumentStem["label"]> }> = [
    {
      stem: bassStem.artifact,
      label: inferInstrumentLabel({
        providerLabel: "Bass",
        detectedFromArtifactId: bassStem.artifact.id
      })
    },
    {
      stem: drumsStem.artifact,
      label: inferInstrumentLabel({
        providerLabel: "Drums",
        detectedFromArtifactId: drumsStem.artifact.id
      })
    }
  ];
  const calls: Array<{ command: string; args: string[]; options: BasicPitchCommandRunnerOptions | undefined }> = [];
  const runner: BasicPitchCommandRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    const outputDirectory = args.at(-2);
    if (outputDirectory === undefined) {
      throw new Error("Expected Basic Pitch output directory argument.");
    }

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, `stem-${calls.length}_basic_pitch.mid`), midiFileFixture(calls.length));
    return { stdout: "ok", stderr: "" };
  };
  const events: PipelineStepEvent[] = [];
  const provider = new BasicPitchMidiConversionProvider({
    artifactStore,
    command: "basic-pitch-test",
    modelSerialization: "onnx",
    runner
  });

  const result = await provider.convertStemsToMidi(labeledStems, {
    jobId: "job-basic-pitch",
    traceId: "trace-job-basic-pitch",
    emit: (event) => {
      events.push(event);
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.command, "basic-pitch-test");
  assert.equal(calls[0]?.args[0], "--save-midi");
  assert.deepEqual(calls[0]?.args.slice(1, 3), ["--model-serialization", "onnx"]);
  assert.equal(calls[0]?.args[4], fileURLToPath(bassStem.artifact.uri));
  assert.match(calls[0]?.options?.env?.TMPDIR ?? "", /basic-pitch-runtime/);
  assert.match(calls[0]?.options?.env?.NUMBA_CACHE_DIR ?? "", /numba-cache/);
  assert.equal(result.midiFiles[0]?.filename, "job-basic-pitch_01_bass.mid");
  assert.equal(result.midiFiles[0]?.instrument.canonicalName, "bass");
  assert.equal(result.midiFiles[0]?.metadata.provider, "basic-pitch");
  assert.equal(result.midiFiles[0]?.metadata.providerOutputFilename, "stem-1_basic_pitch.mid");
  assert.equal(result.midiFiles[0]?.metadata.basicPitchModelSampleRateHz, 22050);
  assert.equal(result.midiFiles[1]?.filename, "job-basic-pitch_02_drums.mid");
  assert.match(String(result.midiFiles[1]?.metadata.providerWarning), /tonal pitched material/);
  assert.equal(events.some((event) => event.message.includes("drum/percussion MIDI may be approximate")), true);
  assert.deepEqual(await readFile(fileURLToPath(result.midiFiles[0]?.uri ?? "")), midiFileFixture(1));
});

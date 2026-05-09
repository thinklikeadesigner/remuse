import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { inferInstrumentLabel } from "../pipeline/naming.ts";
import type { PipelineStepEvent } from "../pipeline/types.ts";
import { BasicPitchMidiConversionProvider, type BasicPitchModelSerialization } from "../providers/midi/basicPitchMidiConversionProvider.ts";
import { FileArtifactStore } from "../storage/fileArtifactStore.ts";

const jobId = "basic-pitch-demo-001";
const rootDir = join(process.cwd(), "var", "remuse-basic-pitch-demo", "artifacts");

function createSineWav(input: { frequencyHz: number; durationSeconds: number }): Buffer {
  const sampleRateHz = 44100;
  const channels = 1;
  const bitDepth = 16;
  const frames = Math.floor(sampleRateHz * input.durationSeconds);
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
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
  buffer.writeUInt32LE(sampleRateHz * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  for (let frame = 0; frame < frames; frame += 1) {
    const envelope = Math.min(1, frame / 2205, (frames - frame) / 2205);
    const sample = Math.round(Math.sin((2 * Math.PI * input.frequencyHz * frame) / sampleRateHz) * 16_000 * envelope);
    buffer.writeInt16LE(sample, 44 + frame * bytesPerSample);
  }

  return buffer;
}

function modelSerializationFromEnv(value: string | undefined): BasicPitchModelSerialization | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  if (value === "tensorflow") {
    return "tf";
  }

  if (value === "tf" || value === "coreml" || value === "tflite" || value === "onnx") {
    return value;
  }

  throw new Error(`Unsupported BASIC_PITCH_MODEL_SERIALIZATION "${value}".`);
}

const artifactStore = new FileArtifactStore({ rootDir });
const stem = await artifactStore.saveAudioArtifact({
  jobId,
  stage: "instrument-stems",
  kind: "instrument-stem",
  filename: "basic-pitch-demo.piano.wav",
  bytes: createSineWav({ frequencyHz: 440, durationSeconds: 1.25 }),
  sourceArtifactIds: ["demo-dry-audio"],
  metadata: {
    provider: "remuse-basic-pitch-demo",
    stemIndex: 0
  }
});
const label = inferInstrumentLabel({
  providerLabel: "Piano",
  detectedFromArtifactId: stem.artifact.id
});
const modelSerialization = modelSerializationFromEnv(process.env.BASIC_PITCH_MODEL_SERIALIZATION);
const provider = new BasicPitchMidiConversionProvider({
  artifactStore,
  ...(process.env.BASIC_PITCH_COMMAND === undefined || process.env.BASIC_PITCH_COMMAND.trim().length === 0
    ? {}
    : { command: process.env.BASIC_PITCH_COMMAND.trim() }),
  ...(modelSerialization === undefined ? {} : { modelSerialization })
});
const events: PipelineStepEvent[] = [];
const result = await provider.convertStemsToMidi([{ stem: stem.artifact, label }], {
  jobId,
  traceId: `trace-${jobId}`,
  emit: (event) => {
    events.push(event);
  }
});

console.log(
  JSON.stringify(
    {
      jobId,
      stem: {
        filename: stem.artifact.filename,
        path: fileURLToPath(stem.artifact.uri),
        instrument: label.canonicalName
      },
      midiFiles: result.midiFiles.map((file) => ({
        filename: file.filename,
        path: fileURLToPath(file.uri),
        instrument: file.instrument.canonicalName,
        provider: file.metadata.provider,
        byteLength: file.metadata.byteLength
      })),
      eventCount: events.length
    },
    null,
    2
  )
);

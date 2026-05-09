import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inferInstrumentLabel } from "../../src/pipeline/naming.ts";
import type { InstrumentStem } from "../../src/pipeline/types.ts";
import type { MidiConversionJobRequest } from "../../src/providers/contracts/externalAudioContracts.ts";
import { HttpMidiConversionProvider } from "../../src/providers/midi/httpMidiConversionProvider.ts";
import { FileArtifactStore } from "../../src/storage/fileArtifactStore.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

function midiFileFixture(): Buffer {
  return Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01, 0x00, 0x01, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b,
    0x00, 0x00, 0x00, 0x04, 0x00, 0xff, 0x2f, 0x00
  ]);
}

function headersFrom(input: HeadersInit | undefined): Headers {
  return new Headers(input);
}

test("HttpMidiConversionProvider submits labeled stems and persists returned MIDI artifacts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-http-midi-"));
  const artifactStore = new FileArtifactStore({ rootDir });
  const bassStem = await artifactStore.saveAudioArtifact({
    jobId: "job-midi",
    stage: "instrument-stems",
    kind: "instrument-stem",
    filename: "stem-01-bass.wav",
    bytes: createPcmWavFixture({ bitDepth: 16 }),
    sourceArtifactIds: ["dry-1"],
    metadata: { provider: "mvsep" }
  });
  const guitarStem = await artifactStore.saveAudioArtifact({
    jobId: "job-midi",
    stage: "instrument-stems",
    kind: "instrument-stem",
    filename: "stem-02-guitar.wav",
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
      stem: guitarStem.artifact,
      label: inferInstrumentLabel({
        providerLabel: "Guitar",
        detectedFromArtifactId: guitarStem.artifact.id
      })
    }
  ];
  const requests: MidiConversionJobRequest[] = [];
  let createHeaders: Headers | undefined;
  const midiBytes = midiFileFixture();
  const fetchImpl: typeof fetch = async (url, init) => {
    const href = url instanceof URL ? url.href : String(url);
    if (href === "https://midi.example.test/v1/midi-conversion/jobs" && init?.method === "POST") {
      createHeaders = headersFrom(init.headers);
      const body = init.body;
      if (typeof body !== "string") {
        throw new Error("Expected JSON string request body.");
      }
      requests.push(JSON.parse(body) as MidiConversionJobRequest);

      return new Response(
        JSON.stringify({
          providerJobId: "provider-midi-job-1",
          status: "accepted",
          statusUrl: "/v1/midi-conversion/jobs/provider-midi-job-1"
        }),
        { status: 202, headers: { "content-type": "application/json" } }
      );
    }

    if (href === "https://midi.example.test/v1/midi-conversion/jobs/provider-midi-job-1") {
      const request = requests[0];
      if (request === undefined) {
        throw new Error("Expected MIDI conversion create request before polling.");
      }

      return new Response(
        JSON.stringify({
          providerJobId: "provider-midi-job-1",
          status: "succeeded",
          midiFiles: request.stems.map((stem) => ({
            stemIndex: stem.stemIndex,
            label: stem.label,
            midi: {
              artifactId: `provider-midi-${stem.stemIndex}`,
              url: `https://midi.example.test/files/${stem.outputFilename}`,
              filename: stem.outputFilename,
              mediaType: "audio/midi",
              sha256: "provider-sha",
              midiFormat: 1,
              ticksPerQuarter: 480
            }
          }))
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (href.startsWith("https://midi.example.test/files/")) {
      return new Response(new Uint8Array(midiBytes), { status: 200, headers: { "content-type": "audio/midi" } });
    }

    throw new Error(`Unexpected fetch URL: ${href}`);
  };
  const provider = new HttpMidiConversionProvider({
    artifactStore,
    baseUrl: "https://midi.example.test",
    apiToken: "secret",
    pollIntervalMs: 0,
    maxPollAttempts: 1,
    fetchImpl
  });

  const result = await provider.convertStemsToMidi(labeledStems, {
    jobId: "job-midi",
    traceId: "trace-job-midi",
    emit: () => undefined
  });

  assert.equal(createHeaders?.get("authorization"), "Bearer secret");
  assert.equal(createHeaders?.get("idempotency-key"), "remuse-job-midi-midi-conversion");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.stems[0]?.outputFilename, "job-midi_01_bass.mid");
  assert.equal(requests[0]?.stems[1]?.outputFilename, "job-midi_02_guitar.mid");
  assert.equal(requests[0]?.stems[0]?.label.canonicalName, "bass");
  assert.equal(requests[0]?.stems[0]?.audio.url.startsWith("file://"), true);
  assert.equal(result.midiFiles.length, 2);
  assert.equal(result.midiFiles[0]?.filename, "job-midi_01_bass.mid");
  assert.equal(result.midiFiles[0]?.instrument.canonicalName, "bass");
  assert.equal(result.midiFiles[0]?.metadata.providerJobId, "provider-midi-job-1");
  assert.equal(result.midiFiles[0]?.metadata.normalizedInstrument, "bass");
  assert.deepEqual(await readFile(fileURLToPath(result.midiFiles[0]?.uri ?? "")), midiBytes);
});

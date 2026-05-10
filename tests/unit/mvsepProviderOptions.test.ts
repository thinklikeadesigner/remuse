import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MvsepClient } from "../../src/providers/mvsep/client.ts";
import {
  MVSEP_DEREVERB_MODEL_TYPE,
  MVSEP_DEREVERB_PREPROCESS_MODE,
  MVSEP_DEREVERB_SEP_TYPE,
  MVSEP_INSTRUMENT_STEM_ALGORITHM_NAME,
  MVSEP_INSTRUMENT_STEM_MAX_OUTPUT_FILES,
  MVSEP_INSTRUMENT_STEM_SEP_TYPE,
  MvsepInstrumentStemSeparationProvider
} from "../../src/providers/mvsep/providers.ts";
import { FileArtifactStore } from "../../src/storage/fileArtifactStore.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("MVSEP de-reverb options select FoxJoy MDX23C reverb removal", () => {
  assert.equal(MVSEP_DEREVERB_SEP_TYPE, 22);
  assert.equal(MVSEP_DEREVERB_MODEL_TYPE, "0");
  assert.equal(MVSEP_DEREVERB_PREPROCESS_MODE, "1");
});

test("MVSEP instrument stem options select BS Roformer SW", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-mvsep-options-"));
  const artifactStore = new FileArtifactStore({ rootDir });
  const dryOnly = await artifactStore.saveAudioArtifact({
    jobId: "job-mvsep-options",
    stage: "dereverb",
    kind: "dry-audio",
    filename: "source.dry-only.wav",
    bytes: createPcmWavFixture(),
    sourceArtifactIds: ["input"]
  });
  let submittedForm: FormData | undefined;
  const client = new MvsepClient({
    apiToken: "test-token",
    baseUrl: "https://mvsep.example.test",
    pollIntervalMs: 0,
    maxPollAttempts: 1,
    fetchImpl: async (url, init) => {
      const pathname = url instanceof URL ? url.pathname : new URL(String(url)).pathname;

      if (pathname.endsWith("/api/separation/create")) {
        submittedForm = init?.body as FormData;
        return Response.json({ success: true, data: { hash: "mvsep-job-1" } });
      }

      return Response.json({ success: true, status: "done", data: { files: [] } });
    }
  });
  const provider = new MvsepInstrumentStemSeparationProvider(client, artifactStore);

  await assert.rejects(
    () =>
      provider.separateInstruments(dryOnly.artifact, {
        jobId: "job-mvsep-options",
        traceId: "trace-job-mvsep-options",
        emit: () => undefined
      }),
    /did not return any stem artifacts/
  );

  assert.equal(MVSEP_INSTRUMENT_STEM_SEP_TYPE, 63);
  assert.equal(MVSEP_INSTRUMENT_STEM_ALGORITHM_NAME, "BS Roformer SW");
  assert.equal(MVSEP_INSTRUMENT_STEM_MAX_OUTPUT_FILES, 7);
  assert.equal(submittedForm?.get("sep_type"), "63");
  assert.equal(submittedForm?.get("add_opt1"), null);
  assert.equal(submittedForm?.get("add_opt2"), null);
});

test("MVSEP BS Roformer SW rejects unexpected extra stem outputs", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-mvsep-output-count-"));
  const artifactStore = new FileArtifactStore({ rootDir });
  const dryOnly = await artifactStore.saveAudioArtifact({
    jobId: "job-mvsep-output-count",
    stage: "dereverb",
    kind: "dry-audio",
    filename: "source.wav",
    bytes: createPcmWavFixture(),
    sourceArtifactIds: ["input"]
  });
  const client = new MvsepClient({
    apiToken: "test-token",
    baseUrl: "https://mvsep.example.test",
    pollIntervalMs: 0,
    maxPollAttempts: 1,
    fetchImpl: async (url) => {
      const pathname = url instanceof URL ? url.pathname : new URL(String(url)).pathname;

      if (pathname.endsWith("/api/separation/create")) {
        return Response.json({ success: true, data: { hash: "mvsep-job-extra-stems" } });
      }

      return Response.json({
        success: true,
        status: "done",
        data: {
          files: Array.from({ length: 8 }, (_, index) => ({
            label: `stem-${index + 1}`,
            url: `https://cdn.example.test/stem-${index + 1}.wav`
          }))
        }
      });
    }
  });
  const provider = new MvsepInstrumentStemSeparationProvider(client, artifactStore);

  await assert.rejects(
    () =>
      provider.separateInstruments(dryOnly.artifact, {
        jobId: "job-mvsep-output-count",
        traceId: "trace-job-mvsep-output-count",
        emit: () => undefined
      }),
    /expected at most 7/
  );
});

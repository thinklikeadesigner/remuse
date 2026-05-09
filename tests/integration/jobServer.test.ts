import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJobServer } from "../../src/server/http.ts";
import { parseWavFormat } from "../../src/audio/wav.ts";
import { createMockProviders } from "../../src/providers/mock/index.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("job backend accepts WAV upload, tracks state, and exposes mock pipeline result", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-job-server-"));
  const app = createJobServer({ rootDir });
  const upload = createPcmWavFixture();

  const created = (await app.api.createJobFromUpload({
    bytes: upload,
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string; statusUrl: string; resultUrl: string };
  assert.match(created.jobId, /^job_/);
  assert.equal(created.statusUrl, `/v1/jobs/${created.jobId}`);

  let status = (await app.api.getJobStatus(created.jobId)) as {
    status: string;
    events: Array<{ step: string; status: string }>;
  };

  for (let attempt = 0; attempt < 20 && status.status !== "succeeded"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  }

  assert.equal(status.status, "succeeded");
  assert.equal(status.events.at(-1)?.step, "opendaw-bounce");
  assert.equal(status.events.at(-1)?.status, "succeeded");

  assert.equal(created.resultUrl, `/v1/jobs/${created.jobId}/result`);
  const result = (await app.api.getJobResult(created.jobId)) as {
    jobId: string;
    inputAudio: { filename: string };
    midi: { midiFiles: Array<{ filename: string }> };
    bounce: { bounce: { filename: string; format: { bitDepth: number } } };
  };

  assert.equal(result.jobId, created.jobId);
  assert.equal(result.inputAudio.filename, "source.wav");
  assert.ok(result.midi.midiFiles.every((file) => file.filename.endsWith(".mid")));
  assert.equal(result.bounce.bounce.filename.endsWith(".bounce.wav"), true);
  assert.equal(result.bounce.bounce.format.bitDepth, 16);
});

test("job backend pauses for human review of non-specific stems and resumes after selection", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-manual-review-"));
  const app = createJobServer({
    rootDir,
    providers: ({ artifactStore }) => {
      const providers = createMockProviders();
      providers.instrumentStemSeparation = {
        async separateInstruments(dryOnly, context) {
          const bytes = createPcmWavFixture({ frames: 44100 * 8 });
          const audibleFrame = 44100 * 3;
          bytes.writeInt16LE(12000, 44 + audibleFrame * 2 * 2);
          bytes.writeInt16LE(12000, 44 + (audibleFrame * 2 + 1) * 2);
          const stored = await artifactStore.saveAudioArtifact({
            jobId: context.jobId,
            stage: "instrument-stems",
            kind: "instrument-stem",
            filename: "source.dry-only.stem-01.other.wav",
            bytes,
            sourceArtifactIds: [dryOnly.id],
            metadata: {
              provider: "test-stem-provider",
              providerLabel: "Other"
            }
          });

          return [{ stem: stored.artifact }];
        }
      };

      return providers;
    }
  });

  const created = (await app.api.createJobFromUpload({
    bytes: createPcmWavFixture(),
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string };

  let status = (await app.api.getJobStatus(created.jobId)) as {
    status: string;
    pendingInstrumentReviews: Array<{
      id: string;
      clip: { metadata: { clipStartSeconds: number; containsAudio: boolean } };
      options: Array<{ displayName: string }>;
    }>;
  };

  for (let attempt = 0; attempt < 20 && status.status !== "awaiting-review"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  }

  assert.equal(status.status, "awaiting-review");
  assert.deepEqual(
    status.pendingInstrumentReviews[0]?.options.map((option) => option.displayName),
    ["Brass", "Woodwinds", "Percussion", "Strings", "Organ", "Synthesizer"]
  );
  assert.equal(status.pendingInstrumentReviews[0]?.clip.metadata.containsAudio, true);
  assert.ok((status.pendingInstrumentReviews[0]?.clip.metadata.clipStartSeconds ?? 0) > 0);

  const reviewId = status.pendingInstrumentReviews[0]?.id;
  assert.equal(typeof reviewId, "string");
  const clip = await app.api.getInstrumentReviewClip(created.jobId, reviewId);
  assert.equal(parseWavFormat(clip.bytes).durationSeconds, 5);

  await app.api.submitInstrumentReview(created.jobId, reviewId, "Brass");

  let resumedStatus = (await app.api.getJobStatus(created.jobId)) as { status: string };
  for (let attempt = 0; attempt < 20 && resumedStatus.status !== "succeeded"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    resumedStatus = (await app.api.getJobStatus(created.jobId)) as typeof resumedStatus;
  }

  assert.equal(resumedStatus.status, "succeeded");

  const result = (await app.api.getJobResult(created.jobId)) as {
    manualReviews: Array<{ selectedLabel: { canonicalName: string } }>;
    midi: { midiFiles: Array<{ filename: string }> };
  };

  assert.equal(result.manualReviews[0]?.selectedLabel.canonicalName, "brass");
  assert.equal(result.midi.midiFiles[0]?.filename.endsWith("_brass.mid"), true);
});

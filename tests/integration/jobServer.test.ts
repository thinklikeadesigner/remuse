import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJobServer } from "../../src/server/http.ts";
import { parseWavFormat } from "../../src/audio/wav.ts";
import { createProvidersFromEnvironment } from "../../src/providers/index.ts";
import { createMockProviders } from "../../src/providers/mock/index.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("job backend accepts WAV upload, tracks state, and exposes mock pipeline result", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-job-server-"));
  const app = createJobServer({
    rootDir,
    providers: ({ artifactStore }) =>
      createProvidersFromEnvironment({
        artifactStore,
        env: {
          REMUSE_PROVIDER: "mock",
          REMUSE_OPENDAW_PROVIDER: "local-session"
        }
      })
  });
  const upload = createPcmWavFixture();
  const uploadParsed = parseWavFormat(upload);

  const created = (await app.api.createJobFromUpload({
    bytes: upload,
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string; statusUrl: string; resultUrl: string; reviewUrl: string };
  assert.match(created.jobId, /^job_/);
  assert.equal(created.statusUrl, `/v1/jobs/${created.jobId}`);
  assert.equal(created.reviewUrl, `/review/${created.jobId}`);

  let status = (await app.api.getJobStatus(created.jobId)) as {
    status: string;
    events: Array<{ step: string; status: string }>;
  };

  for (let attempt = 0; attempt < 20 && status.status !== "succeeded"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  }

  assert.equal(status.status, "succeeded");
  assert.equal(status.events.find((event) => event.step === "de-reverb")?.status, "skipped");
  assert.equal(status.events.at(-1)?.step, "opendaw-bounce");
  assert.equal(status.events.at(-1)?.status, "succeeded");

  assert.equal(created.resultUrl, `/v1/jobs/${created.jobId}/result`);
  const result = (await app.api.getJobResult(created.jobId)) as {
    jobId: string;
    inputAudio: { filename: string };
    midi: { midiFiles: Array<{ filename: string }> };
    bounce: { bounce: { filename: string; format: { bitDepth: number }; metadata: Record<string, unknown> } };
  };

  assert.equal(result.jobId, created.jobId);
  assert.equal(result.inputAudio.filename, "source.wav");
  assert.ok(result.midi.midiFiles.every((file) => file.filename.endsWith(".mid")));
  assert.equal(result.bounce.bounce.filename.endsWith(".bounce.wav"), true);
  assert.equal(result.bounce.bounce.format.bitDepth, 16);

  const bounce = await app.api.getJobBounce(created.jobId);
  assert.equal(bounce.filename, result.bounce.bounce.filename);
  const bounceParsed = parseWavFormat(bounce.bytes);
  assert.equal(bounceParsed.format.bitDepth, 16);
  assert.equal(bounceParsed.dataBytes, uploadParsed.dataBytes);
  assert.equal(result.bounce.bounce.metadata.renderDurationNormalized, true);
  assert.equal(result.bounce.bounce.metadata.targetFrameCount, 8);
});

test("review page shows live progress while a job is active", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-job-progress-"));
  const providers = createMockProviders();
  const originalStemSeparation = providers.instrumentStemSeparation;
  let releaseStemSeparation: () => void = () => undefined;
  const stemSeparationGate = new Promise<void>((resolve) => {
    releaseStemSeparation = resolve;
  });
  providers.instrumentStemSeparation = {
    async separateInstruments(dryOnly, context) {
      await stemSeparationGate;
      return originalStemSeparation.separateInstruments(dryOnly, context);
    }
  };
  const app = createJobServer({ rootDir, providers });

  const created = (await app.api.createJobFromUpload({
    bytes: createPcmWavFixture(),
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string };

  try {
    let status = (await app.api.getJobStatus(created.jobId)) as {
      status: string;
      events: Array<{ step: string; status: string }>;
    };

    for (let attempt = 0; attempt < 20 && status.events.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      status = (await app.api.getJobStatus(created.jobId)) as typeof status;
    }

    assert.equal(status.status, "running");

    const reviewPage = await app.api.getInstrumentReviewPage(created.jobId);
    assert.match(reviewPage, /<section class="progress-dialog" role="status"/);
    assert.match(reviewPage, /<progress max="100" value="/);
    assert.match(reviewPage, /This page refreshes while the job is active\./);
  } finally {
    releaseStemSeparation();
  }
});

test("job backend pauses for human review of non-specific stems and resumes after selection", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-manual-review-"));
  const openedUrls: string[] = [];
  const app = createJobServer({
    rootDir,
    publicBaseUrl: "http://remuse.test",
    autoOpenReview: true,
    openUrl: (url) => {
      openedUrls.push(url);
    },
    providers: ({ artifactStore }) => {
      const providers = createMockProviders();
      providers.instrumentStemSeparation = {
        async separateInstruments(dryOnly, context) {
          const createReviewStem = async (index: number) => {
            const bytes = createPcmWavFixture({ frames: 44100 * 8 });
            const audibleFrame = 44100 * 3;
            bytes.writeInt16LE(12000 + index, 44 + audibleFrame * 2 * 2);
            bytes.writeInt16LE(12000 + index, 44 + (audibleFrame * 2 + 1) * 2);
            const stored = await artifactStore.saveAudioArtifact({
              jobId: context.jobId,
              stage: "instrument-stems",
              kind: "instrument-stem",
              filename: `source.dry-only.stem-0${index}.other.wav`,
              bytes,
              sourceArtifactIds: [dryOnly.id],
              metadata: {
                provider: "test-stem-provider",
                providerLabel: "Other"
              }
            });

            return { stem: stored.artifact };
          };

          return [await createReviewStem(1), await createReviewStem(2)];
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
  assert.deepEqual(openedUrls, [`http://remuse.test/review/${created.jobId}`]);

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
  assert.equal(status.pendingInstrumentReviews.length, 2);
  assert.deepEqual(
    status.pendingInstrumentReviews[0]?.options.map((option) => option.displayName),
    ["Brass", "Woodwinds", "Strings", "Percussion", "Organ", "Synthesizer"]
  );
  assert.equal(status.pendingInstrumentReviews[0]?.clip.metadata.containsAudio, true);
  assert.ok((status.pendingInstrumentReviews[0]?.clip.metadata.clipStartSeconds ?? 0) > 0);

  const reviewId = status.pendingInstrumentReviews[0]?.id;
  const discardReviewId = status.pendingInstrumentReviews[1]?.id;
  if (reviewId === undefined || discardReviewId === undefined) {
    throw new Error("Expected two pending review IDs.");
  }
  const reviewPage = await app.api.getInstrumentReviewPage(created.jobId);
  assert.match(reviewPage, /<audio controls/);
  assert.match(reviewPage, new RegExp(reviewId));
  assert.match(reviewPage, new RegExp(discardReviewId));
  assert.match(reviewPage, /<option value="Organ">Organ<\/option>/);
  assert.match(reviewPage, /<button class="discard-button" type="submit">Discard<\/button>/);
  assert.match(reviewPage, new RegExp(`/review/${created.jobId}/${reviewId}`));

  const clip = await app.api.getInstrumentReviewClip(created.jobId, reviewId);
  assert.equal(parseWavFormat(clip.bytes).durationSeconds, 5);

  await app.api.submitInstrumentReview(created.jobId, reviewId, "Organ");
  const resolvedReviewPage = await app.api.getInstrumentReviewPage(created.jobId);
  assert.match(resolvedReviewPage, /review-card is-resolved/);
  assert.match(resolvedReviewPage, /Selected: <strong>organ<\/strong>/);
  assert.doesNotMatch(resolvedReviewPage, new RegExp(`<form method="post" action="/review/${created.jobId}/${reviewId}"`));

  await app.api.discardInstrumentReview(created.jobId, discardReviewId);
  const discardedReviewPage = await app.api.getInstrumentReviewPage(created.jobId);
  assert.match(discardedReviewPage, /Discarded from workflow\./);

  let resumedStatus = (await app.api.getJobStatus(created.jobId)) as { status: string };
  for (let attempt = 0; attempt < 20 && resumedStatus.status !== "succeeded"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    resumedStatus = (await app.api.getJobStatus(created.jobId)) as typeof resumedStatus;
  }

  assert.equal(resumedStatus.status, "succeeded");

  const result = (await app.api.getJobResult(created.jobId)) as {
    manualReviews: Array<{ status: string; selectedLabel?: { canonicalName: string } }>;
    midi: { midiFiles: Array<{ filename: string }> };
  };

  assert.equal(result.manualReviews[0]?.selectedLabel?.canonicalName, "organ");
  assert.equal(result.manualReviews[1]?.status, "discarded");
  assert.equal(result.midi.midiFiles.length, 1);
  assert.equal(result.midi.midiFiles[0]?.filename.endsWith("_organ.mid"), true);
});
